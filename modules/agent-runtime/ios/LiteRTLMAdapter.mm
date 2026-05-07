#import "LiteRTLMAdapter.h"
#import "Vendor/LiteRTLM/include/engine.h"
#include <string.h>

#if defined(__APPLE__)
#define LITERT_LM_WEAK_IMPORT __attribute__((weak_import))
#else
#define LITERT_LM_WEAK_IMPORT
#endif

extern "C" {
// LiteRT-LM v0.11.0 split conversation config creation into a no-arg create
// plus setters, and added MTP/speculative decoding controls. Keep these weak so
// the current v0.10.x vendored runtime can still link until the xcframework is
// rebuilt.
void litert_lm_conversation_config_set_session_config(
    LiteRtLmConversationConfig *config,
    const LiteRtLmSessionConfig *session_config) LITERT_LM_WEAK_IMPORT;
void litert_lm_conversation_config_set_system_message(
    LiteRtLmConversationConfig *config,
    const char *system_message_json) LITERT_LM_WEAK_IMPORT;
void litert_lm_conversation_config_set_tools(
    LiteRtLmConversationConfig *config,
    const char *tools_json) LITERT_LM_WEAK_IMPORT;
void litert_lm_conversation_config_set_messages(
    LiteRtLmConversationConfig *config,
    const char *messages_json) LITERT_LM_WEAK_IMPORT;
void litert_lm_conversation_config_set_enable_constrained_decoding(
    LiteRtLmConversationConfig *config,
    bool enable_constrained_decoding) LITERT_LM_WEAK_IMPORT;
void litert_lm_engine_settings_set_parallel_file_section_loading(
    LiteRtLmEngineSettings *settings,
    bool parallel_file_section_loading) LITERT_LM_WEAK_IMPORT;
void litert_lm_engine_settings_set_enable_speculative_decoding(
    LiteRtLmEngineSettings *settings,
    bool enable_speculative_decoding) LITERT_LM_WEAK_IMPORT;
}

static NSString *const LiteRTLMAdapterErrorDomain = @"AgentRuntimeLiteRTLMAdapter";

typedef NS_ENUM(NSInteger, LiteRTLMAdapterErrorCode) {
  LiteRTLMAdapterErrorRuntimeUnavailable = 501,
  LiteRTLMAdapterErrorModelLoadFailed = 502,
  LiteRTLMAdapterErrorExecutionFailed = 503,
  LiteRTLMAdapterErrorInvalidResponse = 504,
};

static id _Nullable LiteRTLMParseJSONObjectFromUTF8(const char *jsonCString);
static LiteRtLmSamplerParams LiteRTLMSamplerParamsFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig);

static NSError *LiteRTLMError(NSInteger code, NSString *description,
                              NSDictionary<NSString *, id> *context) {
  NSMutableDictionary<NSString *, id> *userInfo = [context mutableCopy];
  userInfo[NSLocalizedDescriptionKey] = description;

  return [NSError errorWithDomain:LiteRTLMAdapterErrorDomain code:code userInfo:userInfo];
}

static void LiteRTLMLogSmokeTestFailure(NSString *stage,
                                        NSString *description,
                                        NSDictionary<NSString *, id> *details) {
  NSLog(@"[LiteRTLMAdapter] Smoke test failed stage=%@ description=%@ details=%@",
        stage ?: @"unknown",
        description ?: @"",
        details ?: @{});
}

static NSString *LiteRTLMHexStringFromData(NSData *data) {
  const unsigned char *bytes = static_cast<const unsigned char *>(data.bytes);
  NSMutableString *hex = [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger index = 0; index < data.length; index += 1) {
    [hex appendFormat:@"%02x", bytes[index]];
  }
  return [hex copy];
}

static NSDictionary<NSString *, id> *LiteRTLMCollectModelFileDiagnostics(NSString *modelPath) {
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSMutableDictionary<NSString *, id> *diagnostics = [NSMutableDictionary dictionary];

  diagnostics[@"modelPath"] = modelPath ?: @"";
  diagnostics[@"physicalMemoryBytes"] = @(NSProcessInfo.processInfo.physicalMemory);

  BOOL isDirectory = NO;
  BOOL fileExists = [fileManager fileExistsAtPath:modelPath isDirectory:&isDirectory];
  diagnostics[@"fileExists"] = @(fileExists);
  diagnostics[@"isDirectory"] = @(isDirectory);
  diagnostics[@"isReadable"] = @([fileManager isReadableFileAtPath:modelPath]);

  NSString *filesystemPath =
      fileExists ? modelPath : [modelPath stringByDeletingLastPathComponent];
  NSDictionary<NSFileAttributeKey, id> *filesystemAttributes =
      [fileManager attributesOfFileSystemForPath:filesystemPath error:nil];
  if (filesystemAttributes[NSFileSystemFreeSize] != nil) {
    diagnostics[@"filesystemFreeBytes"] = filesystemAttributes[NSFileSystemFreeSize];
  }

  if (!fileExists || isDirectory) {
    return diagnostics;
  }

  NSDictionary<NSFileAttributeKey, id> *fileAttributes =
      [fileManager attributesOfItemAtPath:modelPath error:nil];
  if (fileAttributes[NSFileSize] != nil) {
    diagnostics[@"fileSizeBytes"] = fileAttributes[NSFileSize];
  }
  if (fileAttributes[NSFileProtectionKey] != nil) {
    diagnostics[@"fileProtection"] = fileAttributes[NSFileProtectionKey];
  }
  if (fileAttributes[NSFileModificationDate] != nil) {
    NSDate *modifiedAt = fileAttributes[NSFileModificationDate];
    diagnostics[@"modifiedAtMs"] = @((long long)([modifiedAt timeIntervalSince1970] * 1000.0));
  }

  NSFileHandle *fileHandle = [NSFileHandle fileHandleForReadingAtPath:modelPath];
  NSData *prefix = [fileHandle readDataOfLength:16];
  [fileHandle closeFile];
  if (prefix.length > 0) {
    NSUInteger prefixLength = MIN((NSUInteger)16, prefix.length);
    NSData *prefixSlice = [prefix subdataWithRange:NSMakeRange(0, prefixLength)];
    diagnostics[@"headerPrefixHex"] = LiteRTLMHexStringFromData(prefixSlice);

    NSUInteger magicLength = MIN((NSUInteger)8, prefix.length);
    NSData *magicSlice = [prefix subdataWithRange:NSMakeRange(0, magicLength)];
    NSString *magicASCII = [[NSString alloc] initWithData:magicSlice encoding:NSASCIIStringEncoding];
    if (magicASCII != nil) {
      diagnostics[@"magicASCII"] = magicASCII;
    }
  }

  return diagnostics;
}

static NSDictionary<NSString *, id> *LiteRTLMCollectInputFileDiagnostics(NSString *path) {
  NSMutableDictionary<NSString *, id> *diagnostics = [NSMutableDictionary dictionary];
  diagnostics[@"path"] = path ?: @"";

  if (path.length == 0) {
    diagnostics[@"present"] = @NO;
    return diagnostics;
  }

  diagnostics[@"present"] = @YES;

  NSFileManager *fileManager = [NSFileManager defaultManager];
  BOOL isDirectory = NO;
  BOOL fileExists = [fileManager fileExistsAtPath:path isDirectory:&isDirectory];
  diagnostics[@"fileExists"] = @(fileExists);
  diagnostics[@"isDirectory"] = @(isDirectory);
  diagnostics[@"isReadable"] = @([fileManager isReadableFileAtPath:path]);
  diagnostics[@"pathExtension"] = path.pathExtension.lowercaseString ?: @"";

  if (!fileExists || isDirectory) {
    return diagnostics;
  }

  NSDictionary<NSFileAttributeKey, id> *fileAttributes =
      [fileManager attributesOfItemAtPath:path error:nil];
  if (fileAttributes[NSFileSize] != nil) {
    diagnostics[@"fileSizeBytes"] = fileAttributes[NSFileSize];
  }
  if (fileAttributes[NSFileModificationDate] != nil) {
    NSDate *modifiedAt = fileAttributes[NSFileModificationDate];
    diagnostics[@"modifiedAtMs"] = @((long long)([modifiedAt timeIntervalSince1970] * 1000.0));
  }

  return diagnostics;
}

static NSString *LiteRTLMTruncatedString(NSString *value, NSUInteger limit) {
  if (value.length <= limit) {
    return value;
  }
  return [value substringToIndex:limit];
}

static NSInteger LiteRTLMPositiveIntegerValue(id value, NSInteger fallback) {
  if ([value isKindOfClass:[NSNumber class]]) {
    NSInteger integerValue = [(NSNumber *)value integerValue];
    if (integerValue > 0) {
      return integerValue;
    }
  }

  return fallback;
}

static float LiteRTLMFloatValue(id value, float fallback) {
  if ([value isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)value floatValue];
  }

  return fallback;
}

static BOOL LiteRTLMBooleanValue(id value, BOOL fallback) {
  if ([value isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)value boolValue];
  }

  return fallback;
}

static NSArray<NSString *> *LiteRTLMPreferredBackendsFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  NSMutableArray<NSString *> *preferredBackends = [NSMutableArray array];
  id rawBackends = runtimeConfig[@"preferredBackends"];
  if ([rawBackends isKindOfClass:[NSArray class]]) {
    for (id rawBackend in (NSArray *)rawBackends) {
      if (![rawBackend isKindOfClass:[NSString class]]) {
        continue;
      }

      NSString *backend = [[(NSString *)rawBackend lowercaseString]
          stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
      if (backend.length > 0) {
        [preferredBackends addObject:backend];
      }
    }
  }

  if (preferredBackends.count == 0) {
    return @[ @"gpu", @"cpu" ];
  }

  return [preferredBackends copy];
}

static NSString * _Nullable LiteRTLMOptionalBackendFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig,
    NSString *key,
    NSString * _Nullable fallback) {
  id rawBackend = runtimeConfig[key];
  if (rawBackend == NSNull.null) {
    return nil;
  }
  if ([rawBackend isKindOfClass:[NSString class]]) {
    NSString *backend = [[(NSString *)rawBackend lowercaseString]
        stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return backend.length > 0 ? backend : fallback;
  }

  return fallback;
}

static NSString * _Nullable LiteRTLMVisionBackendFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  return LiteRTLMOptionalBackendFromRuntimeConfig(runtimeConfig, @"visionBackend", nil);
}

static NSString * _Nullable LiteRTLMAudioBackendFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  return LiteRTLMOptionalBackendFromRuntimeConfig(runtimeConfig, @"audioBackend", nil);
}

static NSInteger LiteRTLMMaxNumTokensFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  return LiteRTLMPositiveIntegerValue(runtimeConfig[@"maxNumTokens"], 4096);
}

static NSInteger LiteRTLMMaxOutputTokensFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  return LiteRTLMPositiveIntegerValue(runtimeConfig[@"maxOutputTokens"], 192);
}

static BOOL LiteRTLMVerboseNativeLoggingFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  return LiteRTLMBooleanValue(runtimeConfig[@"enableVerboseNativeLogging"], NO);
}

static BOOL LiteRTLMParallelFileSectionLoadingFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  return LiteRTLMBooleanValue(runtimeConfig[@"parallelFileSectionLoading"], YES);
}

static BOOL LiteRTLMEnableSpeculativeDecodingForBackend(
    NSDictionary<NSString *, id> *runtimeConfig,
    NSString *backend) {
  id rawValue = runtimeConfig[@"enableSpeculativeDecoding"];
  if ([rawValue isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)rawValue boolValue] && [backend isEqualToString:@"gpu"];
  }

  return [backend isEqualToString:@"gpu"];
}

static __attribute__((unused)) LiteRtLmConversationConfig *LiteRTLMConversationConfigCreateWithAPI(
    LiteRtLmConversationConfig *(*createFn)(
        LiteRtLmEngine *,
        const LiteRtLmSessionConfig *,
        const char *,
        const char *,
        const char *,
        bool),
    LiteRtLmEngine *engine,
    LiteRtLmSessionConfig *sessionConfig,
    const char *systemMessageJSON,
    const char *toolsJSON,
    const char *messagesJSON,
    bool enableConstrainedDecoding) {
  return createFn(
      engine,
      sessionConfig,
      systemMessageJSON,
      toolsJSON,
      messagesJSON,
      enableConstrainedDecoding);
}

static LiteRtLmConversationConfig *LiteRTLMConversationConfigCreateWithAPI(
    LiteRtLmConversationConfig *(*createFn)(),
    LiteRtLmEngine *engine,
    LiteRtLmSessionConfig *sessionConfig,
    const char *systemMessageJSON,
    const char *toolsJSON,
    const char *messagesJSON,
    bool enableConstrainedDecoding) {
  (void)engine;
  LiteRtLmConversationConfig *config = createFn();
  if (config == nullptr) {
    return nullptr;
  }

  if (sessionConfig != nullptr) {
    if (litert_lm_conversation_config_set_session_config == nullptr) {
      litert_lm_conversation_config_delete(config);
      return nullptr;
    }
    litert_lm_conversation_config_set_session_config(config, sessionConfig);
  }
  if (systemMessageJSON != nullptr) {
    if (litert_lm_conversation_config_set_system_message == nullptr) {
      litert_lm_conversation_config_delete(config);
      return nullptr;
    }
    litert_lm_conversation_config_set_system_message(config, systemMessageJSON);
  }
  if (toolsJSON != nullptr) {
    if (litert_lm_conversation_config_set_tools == nullptr) {
      litert_lm_conversation_config_delete(config);
      return nullptr;
    }
    litert_lm_conversation_config_set_tools(config, toolsJSON);
  }
  if (messagesJSON != nullptr) {
    if (litert_lm_conversation_config_set_messages == nullptr) {
      litert_lm_conversation_config_delete(config);
      return nullptr;
    }
    litert_lm_conversation_config_set_messages(config, messagesJSON);
  }
  if (enableConstrainedDecoding &&
      litert_lm_conversation_config_set_enable_constrained_decoding == nullptr) {
    litert_lm_conversation_config_delete(config);
    return nullptr;
  }
  if (litert_lm_conversation_config_set_enable_constrained_decoding != nullptr) {
    litert_lm_conversation_config_set_enable_constrained_decoding(
        config,
        enableConstrainedDecoding);
  }

  return config;
}

static LiteRtLmConversationConfig *LiteRTLMConversationConfigCreate(
    LiteRtLmEngine *engine,
    LiteRtLmSessionConfig *sessionConfig,
    const char *systemMessageJSON,
    const char *toolsJSON,
    const char *messagesJSON,
    bool enableConstrainedDecoding) {
  return LiteRTLMConversationConfigCreateWithAPI(
      &litert_lm_conversation_config_create,
      engine,
      sessionConfig,
      systemMessageJSON,
      toolsJSON,
      messagesJSON,
      enableConstrainedDecoding);
}

template <typename InputDataT>
static LiteRtLmResponses *LiteRTLMGenerateTextWithAPI(
    LiteRtLmResponses *(*generateFn)(LiteRtLmSession *, const InputDataT *, size_t),
    LiteRtLmSession *session,
    NSString *text) {
  const char *textBytes = text.UTF8String;
  InputDataT input = {};
  input.type = static_cast<decltype(input.type)>(0);
  input.data = textBytes;
  input.size = strlen(textBytes);
  return generateFn(session, &input, 1);
}

static LiteRtLmResponses *LiteRTLMGenerateText(
    LiteRtLmSession *session,
    NSString *text) {
  return LiteRTLMGenerateTextWithAPI(
      &litert_lm_session_generate_content,
      session,
      text);
}

static NSDictionary<NSString *, id> *LiteRTLMProbeConversationSend(
    LiteRtLmEngine *engine,
    NSDictionary<NSString *, id> *runtimeConfig,
    NSString *systemMessageJSON,
    NSString *toolsJSON,
    NSString *prompt,
    NSArray<NSString *> *imagePaths,
    NSString *label) {
  NSMutableDictionary<NSString *, id> *probe = [NSMutableDictionary dictionary];
  probe[@"label"] = label ?: @"";
  probe[@"imageCount"] = @(imagePaths.count);
  probe[@"imagePaths"] = [imagePaths copy] ?: @[];

  NSMutableArray<NSDictionary<NSString *, id> *> *imageDiagnostics = [NSMutableArray array];
  for (NSString *imagePath in imagePaths) {
    [imageDiagnostics addObject:LiteRTLMCollectInputFileDiagnostics(imagePath)];
  }
  probe[@"imageDiagnostics"] = imageDiagnostics;

  LiteRtLmSessionConfig *sessionConfig = litert_lm_session_config_create();
  if (sessionConfig == nullptr) {
    probe[@"ok"] = @NO;
    probe[@"stage"] = @"session_config_create";
    return probe;
  }

  LiteRtLmSamplerParams samplerParams =
      LiteRTLMSamplerParamsFromRuntimeConfig(runtimeConfig);
  litert_lm_session_config_set_max_output_tokens(
      sessionConfig,
      (int)LiteRTLMMaxOutputTokensFromRuntimeConfig(runtimeConfig));
  litert_lm_session_config_set_sampler_params(sessionConfig, &samplerParams);

  NSMutableArray<NSDictionary<NSString *, id> *> *content = [NSMutableArray array];
  for (NSString *imagePath in imagePaths) {
    [content addObject:@{ @"type": @"image", @"path": imagePath }];
  }
  [content addObject:@{ @"type": @"text", @"text": prompt ?: @"" }];

  NSDictionary<NSString *, id> *message = @{
    @"role": @"user",
    @"content": content,
  };

  NSData *messageData = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  if (messageData == nil) {
    litert_lm_session_config_delete(sessionConfig);
    probe[@"ok"] = @NO;
    probe[@"stage"] = @"message_serialize";
    return probe;
  }

  NSString *messageJSON = [[NSString alloc] initWithData:messageData encoding:NSUTF8StringEncoding];
  probe[@"messageJsonLength"] = @(messageJSON.length);

  LiteRtLmConversationConfig *conversationConfig =
      LiteRTLMConversationConfigCreate(
          engine,
          sessionConfig,
          systemMessageJSON ? systemMessageJSON.UTF8String : nullptr,
          toolsJSON ? toolsJSON.UTF8String : nullptr,
          nullptr,
          false);
  litert_lm_session_config_delete(sessionConfig);

  if (conversationConfig == nullptr) {
    probe[@"ok"] = @NO;
    probe[@"stage"] = @"conversation_config_create";
    return probe;
  }

  LiteRtLmConversation *conversation =
      litert_lm_conversation_create(engine, conversationConfig);
  litert_lm_conversation_config_delete(conversationConfig);

  if (conversation == nullptr) {
    probe[@"ok"] = @NO;
    probe[@"stage"] = @"conversation_create";
    return probe;
  }

  LiteRtLmJsonResponse *jsonResponse =
      litert_lm_conversation_send_message(conversation, messageJSON.UTF8String, nullptr);

  if (jsonResponse == nullptr) {
    litert_lm_conversation_delete(conversation);
    probe[@"ok"] = @NO;
    probe[@"stage"] = @"conversation_send_message";
    return probe;
  }

  const char *responseCString = litert_lm_json_response_get_string(jsonResponse);
  NSString *responseJSONString = responseCString != nullptr
      ? [NSString stringWithUTF8String:responseCString] : nil;
  id responseObject = LiteRTLMParseJSONObjectFromUTF8(responseCString);

  litert_lm_json_response_delete(jsonResponse);
  litert_lm_conversation_delete(conversation);

  probe[@"ok"] = @YES;
  probe[@"stage"] = @"response";
  probe[@"responseLength"] = @(responseJSONString.length);

  if ([responseObject isKindOfClass:[NSDictionary class]]) {
    NSDictionary<NSString *, id> *responseDictionary = (NSDictionary<NSString *, id> *)responseObject;
    probe[@"responseKeys"] = [responseDictionary allKeys] ?: @[];
    probe[@"responseHasToolCalls"] =
        @([responseDictionary[@"tool_calls"] isKindOfClass:[NSArray class]]);
    NSString *action = responseDictionary[@"action"];
    if ([action isKindOfClass:[NSString class]] && action.length > 0) {
      probe[@"responseAction"] = action;
    }
  } else if (responseJSONString.length > 0) {
    probe[@"responsePreview"] = LiteRTLMTruncatedString(responseJSONString, 200);
  }

  return probe;
}

static constexpr NSInteger LiteRTLMSamplerTypeTopK = 1;
static constexpr NSInteger LiteRTLMSamplerTypeTopP = 2;
static constexpr NSInteger LiteRTLMSamplerTypeGreedy = 3;

static NSString *LiteRTLMSamplerTypeName(NSInteger samplerType) {
  switch (samplerType) {
    case LiteRTLMSamplerTypeTopK:
      return @"top_k";
    case LiteRTLMSamplerTypeGreedy:
      return @"greedy";
    case LiteRTLMSamplerTypeTopP:
    case 0:
    default:
      return @"top_p";
  }
}

static LiteRtLmSamplerParams LiteRTLMSamplerParamsFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  LiteRtLmSamplerParams samplerParams = {};
  samplerParams.type = static_cast<decltype(samplerParams.type)>(LiteRTLMSamplerTypeTopP);
  samplerParams.top_k = 1;
  samplerParams.top_p = 0.95f;
  samplerParams.temperature = 1.0f;
  samplerParams.seed = 0;

  id rawSampler = runtimeConfig[@"sampler"];
  if (![rawSampler isKindOfClass:[NSDictionary class]]) {
    return samplerParams;
  }

  NSDictionary<NSString *, id> *samplerConfig = (NSDictionary<NSString *, id> *)rawSampler;
  id rawType = samplerConfig[@"type"];
  if ([rawType isKindOfClass:[NSString class]]) {
    NSString *samplerType = [[(NSString *)rawType lowercaseString]
        stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if ([samplerType isEqualToString:@"top_k"]) {
      samplerParams.type = static_cast<decltype(samplerParams.type)>(LiteRTLMSamplerTypeTopK);
    } else if ([samplerType isEqualToString:@"greedy"]) {
      samplerParams.type = static_cast<decltype(samplerParams.type)>(LiteRTLMSamplerTypeGreedy);
    } else {
      samplerParams.type = static_cast<decltype(samplerParams.type)>(LiteRTLMSamplerTypeTopP);
    }
  }

  samplerParams.top_k = (int32_t)LiteRTLMPositiveIntegerValue(
      samplerConfig[@"topK"], samplerParams.top_k);
  samplerParams.top_p = LiteRTLMFloatValue(samplerConfig[@"topP"], samplerParams.top_p);
  samplerParams.temperature = LiteRTLMFloatValue(
      samplerConfig[@"temperature"], samplerParams.temperature);
  samplerParams.seed = (int32_t)LiteRTLMPositiveIntegerValue(
      samplerConfig[@"seed"], samplerParams.seed);
  return samplerParams;
}

static NSDictionary<NSString *, id> *LiteRTLMRuntimeConfigDiagnostics(
    NSDictionary<NSString *, id> *runtimeConfig) {
  LiteRtLmSamplerParams samplerParams = LiteRTLMSamplerParamsFromRuntimeConfig(runtimeConfig);
  return @{
    @"requestedPreferredBackends": LiteRTLMPreferredBackendsFromRuntimeConfig(runtimeConfig),
    @"requestedVisionBackend": LiteRTLMVisionBackendFromRuntimeConfig(runtimeConfig) ?: @"none",
    @"requestedAudioBackend": LiteRTLMAudioBackendFromRuntimeConfig(runtimeConfig) ?: @"none",
    @"requestedMaxNumTokens": @(LiteRTLMMaxNumTokensFromRuntimeConfig(runtimeConfig)),
    @"requestedMaxOutputTokens": @(LiteRTLMMaxOutputTokensFromRuntimeConfig(runtimeConfig)),
    @"requestedSpeculativeDecoding": runtimeConfig[@"enableSpeculativeDecoding"] ?: @"gpu",
    @"speculativeDecodingApiAvailable":
        @(litert_lm_engine_settings_set_enable_speculative_decoding != nullptr),
    @"parallelFileSectionLoading": @(LiteRTLMParallelFileSectionLoadingFromRuntimeConfig(runtimeConfig)),
    @"requestedSampler": @{
      @"type": LiteRTLMSamplerTypeName(static_cast<NSInteger>(samplerParams.type)),
      @"topK": @(samplerParams.top_k),
      @"topP": @(samplerParams.top_p),
      @"temperature": @(samplerParams.temperature),
      @"seed": @(samplerParams.seed)
    },
    @"verboseNativeLogging": @(LiteRTLMVerboseNativeLoggingFromRuntimeConfig(runtimeConfig))
  };
}

static NSString *LiteRTLMEngineConfigSignature(NSDictionary<NSString *, id> *runtimeConfig) {
  NSArray<NSString *> *preferredBackends = LiteRTLMPreferredBackendsFromRuntimeConfig(runtimeConfig);
  return [NSString stringWithFormat:@"backends=%@|vision=%@|audio=%@|maxTokens=%ld|speculative=%@|parallelFileLoading=%@",
                                    [preferredBackends componentsJoinedByString:@","],
                                    LiteRTLMVisionBackendFromRuntimeConfig(runtimeConfig) ?: @"none",
                                    LiteRTLMAudioBackendFromRuntimeConfig(runtimeConfig) ?: @"none",
                                    (long)LiteRTLMMaxNumTokensFromRuntimeConfig(runtimeConfig),
                                    runtimeConfig[@"enableSpeculativeDecoding"] ?: @"gpu",
                                    @(LiteRTLMParallelFileSectionLoadingFromRuntimeConfig(runtimeConfig))];
}

static id _Nullable LiteRTLMParseJSONObjectFromUTF8(const char *jsonCString) {
  if (jsonCString == nullptr) {
    return nil;
  }
  NSData *jsonData = [NSData dataWithBytes:jsonCString length:strlen(jsonCString)];
  if (jsonData == nil) {
    return nil;
  }
  return [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil];
}

static NSString * _Nullable LiteRTLMExtractTextFromResponseObject(id responseObject) {
  if (![responseObject isKindOfClass:[NSDictionary class]]) {
    return nil;
  }
  NSDictionary<NSString *, id> *responseDictionary = (NSDictionary<NSString *, id> *)responseObject;
  id content = responseDictionary[@"content"];
  if ([content isKindOfClass:[NSString class]]) {
    return content;
  }
  if ([content isKindOfClass:[NSDictionary class]]) {
    id text = ((NSDictionary *)content)[@"text"];
    if ([text isKindOfClass:[NSString class]]) {
      return text;
    }
  }
  if ([content isKindOfClass:[NSArray class]]) {
    NSMutableArray<NSString *> *segments = [NSMutableArray array];
    for (id part in (NSArray *)content) {
      if (![part isKindOfClass:[NSDictionary class]]) continue;
      id type = part[@"type"];
      id text = part[@"text"];
      if ([type isKindOfClass:[NSString class]] && [type isEqualToString:@"text"] &&
          [text isKindOfClass:[NSString class]]) {
        [segments addObject:text];
      }
    }
    if (segments.count > 0) {
      return [segments componentsJoinedByString:@""];
    }
  }
  return nil;
}

@interface LiteRTLMAdapter () {
 @private
  LiteRtLmEngine *_engine;
  NSString *_Nullable _loadedModelPath;
  NSString *_Nullable _loadedEngineConfigSignature;
  NSString *_Nullable _loadedBackend;
  NSString *_Nullable _loadedVisionBackend;
  NSString *_Nullable _loadedAudioBackend;
  NSNumber *_Nullable _loadedMaxNumTokens;
  NSString *_Nullable _loadedCacheMode;
  NSString *_Nullable _loadedCacheDirectory;
  NSArray<NSDictionary<NSString *, id> *> *_Nullable _lastLoadAttempts;
}
@end

@implementation LiteRTLMAdapter

- (void)dealloc {
  @synchronized(self) {
    if (_engine != nullptr) {
      litert_lm_engine_delete(_engine);
      _engine = nullptr;
    }
  }
}

- (nullable LiteRtLmEngine *)ensureEngineWithModelPath:(NSString *)modelPath
                                         runtimeConfig:(NSDictionary<NSString *, id> *)runtimeConfig
                                          wasColdStart:(BOOL *)wasColdStart
                                                 error:(NSError *_Nullable *_Nullable)error {
  @synchronized(self) {
    NSString *requestedEngineConfigSignature = LiteRTLMEngineConfigSignature(runtimeConfig);
    const BOOL needsReload =
        (_engine == nullptr || ![_loadedModelPath isEqualToString:modelPath] ||
         ![_loadedEngineConfigSignature isEqualToString:requestedEngineConfigSignature]);
    if (wasColdStart != nil) {
      *wasColdStart = needsReload;
    }

    if (!needsReload) {
      return _engine;
    }

    if (_engine != nullptr) {
      litert_lm_engine_delete(_engine);
      _engine = nullptr;
      _loadedModelPath = nil;
      _loadedEngineConfigSignature = nil;
      _loadedBackend = nil;
      _loadedVisionBackend = nil;
      _loadedAudioBackend = nil;
      _loadedMaxNumTokens = nil;
      _loadedCacheMode = nil;
      _loadedCacheDirectory = nil;
      _lastLoadAttempts = nil;
    }

    BOOL verboseNativeLogging = LiteRTLMVerboseNativeLoggingFromRuntimeConfig(runtimeConfig);
    if (verboseNativeLogging) {
      NSLog(@"[LiteRTLMAdapter] Loading model from: %@", modelPath);
    }
    litert_lm_set_min_log_level(verboseNativeLogging ? 0 : 1);

    NSDictionary<NSString *, id> *runtimeConfigDiagnostics =
        LiteRTLMRuntimeConfigDiagnostics(runtimeConfig);
    NSDictionary<NSString *, id> *modelFileDiagnostics =
        LiteRTLMCollectModelFileDiagnostics(modelPath);
    NSMutableArray<NSDictionary<NSString *, id> *> *loadAttempts = [NSMutableArray array];

    NSString *cacheDirectory =
        [NSTemporaryDirectory() stringByAppendingPathComponent:@"litert-lm-cache"];
    NSError *cacheDirectoryError = nil;
    BOOL cacheDirectoryReady =
        [[NSFileManager defaultManager] createDirectoryAtPath:cacheDirectory
                                  withIntermediateDirectories:YES
                                                   attributes:nil
                                                        error:&cacheDirectoryError];

    NSArray<NSString *> *preferredBackends =
        LiteRTLMPreferredBackendsFromRuntimeConfig(runtimeConfig);
    NSNumber *configuredMaxNumTokens = @(LiteRTLMMaxNumTokensFromRuntimeConfig(runtimeConfig));
    NSString *configuredVisionBackend = LiteRTLMVisionBackendFromRuntimeConfig(runtimeConfig);
    NSString *configuredAudioBackend = LiteRTLMAudioBackendFromRuntimeConfig(runtimeConfig);
    NSMutableArray<NSDictionary<NSString *, id> *> *attemptPlans = [NSMutableArray array];
    NSMutableSet<NSString *> *attemptPlanSignatures = [NSMutableSet set];
    void (^addAttemptPlan)(NSString *, NSNumber *, BOOL, NSString *, NSString *) = ^(
        NSString *backend, NSNumber *maxNumTokens, BOOL speculativeDecoding, NSString *cacheMode,
        NSString *attemptCacheDirectory) {
      NSString *signature = [NSString
          stringWithFormat:@"%@|%@|%@|%@|%@|%@", backend ?: @"", maxNumTokens ?: @(0),
                           speculativeDecoding ? @"spec" : @"nospec", cacheMode ?: @"",
                           configuredVisionBackend ?: @"none", configuredAudioBackend ?: @"none"];
      if ([attemptPlanSignatures containsObject:signature]) {
        return;
      }
      [attemptPlanSignatures addObject:signature];

      NSMutableDictionary<NSString *, id> *plan = [NSMutableDictionary dictionary];
      plan[@"backend"] = backend;
      plan[@"maxNumTokens"] = maxNumTokens;
      plan[@"speculativeDecoding"] = @(speculativeDecoding);
      plan[@"cacheMode"] = cacheMode;
      if (attemptCacheDirectory.length > 0) {
        plan[@"cacheDirectory"] = attemptCacheDirectory;
      }
      plan[@"visionBackend"] = configuredVisionBackend ?: @"none";
      plan[@"audioBackend"] = configuredAudioBackend ?: @"none";
      [attemptPlans addObject:plan];
    };
    if (cacheDirectoryReady) {
      for (NSString *backend in preferredBackends) {
        NSMutableArray<NSNumber *> *maxNumTokenCandidates =
            [NSMutableArray arrayWithObject:configuredMaxNumTokens];
        if ([backend isEqualToString:@"gpu"] && configuredMaxNumTokens.integerValue > 4096) {
          [maxNumTokenCandidates addObject:@4096];
        }
        if ([backend isEqualToString:@"gpu"] && configuredMaxNumTokens.integerValue > 3072) {
          [maxNumTokenCandidates addObject:@3072];
        }
        BOOL preferredSpeculativeDecoding =
            LiteRTLMEnableSpeculativeDecodingForBackend(runtimeConfig, backend);
        NSArray<NSNumber *> *speculativeDecodingCandidates =
            preferredSpeculativeDecoding ? @[ @YES, @NO ] : @[ @NO ];
        for (NSNumber *maxNumTokens in maxNumTokenCandidates) {
          for (NSNumber *speculativeDecoding in speculativeDecodingCandidates) {
            addAttemptPlan(backend, maxNumTokens, speculativeDecoding.boolValue, @"directory",
                           cacheDirectory);
            addAttemptPlan(backend, maxNumTokens, speculativeDecoding.boolValue, @"nocache", nil);
          }
        }
      }
    } else {
      [loadAttempts addObject:@{
        @"backend" : @"*",
        @"maxNumTokens" : configuredMaxNumTokens,
        @"visionBackend" : configuredVisionBackend ?: @"none",
        @"audioBackend" : configuredAudioBackend ?: @"none",
        @"cacheMode" : @"directory",
        @"cacheDirectory" : cacheDirectory,
        @"engineCreated" : @NO,
        @"skipped" : @YES,
        @"cacheDirectoryError" : cacheDirectoryError.localizedDescription ?: @"unknown",
        @"preferredBackends" : preferredBackends
      }];
      for (NSString *backend in preferredBackends) {
        NSMutableArray<NSNumber *> *maxNumTokenCandidates =
            [NSMutableArray arrayWithObject:configuredMaxNumTokens];
        if ([backend isEqualToString:@"gpu"] && configuredMaxNumTokens.integerValue > 4096) {
          [maxNumTokenCandidates addObject:@4096];
        }
        if ([backend isEqualToString:@"gpu"] && configuredMaxNumTokens.integerValue > 3072) {
          [maxNumTokenCandidates addObject:@3072];
        }
        BOOL preferredSpeculativeDecoding =
            LiteRTLMEnableSpeculativeDecodingForBackend(runtimeConfig, backend);
        NSArray<NSNumber *> *speculativeDecodingCandidates =
            preferredSpeculativeDecoding ? @[ @YES, @NO ] : @[ @NO ];
        for (NSNumber *maxNumTokens in maxNumTokenCandidates) {
          for (NSNumber *speculativeDecoding in speculativeDecodingCandidates) {
            addAttemptPlan(backend, maxNumTokens, speculativeDecoding.boolValue, @"nocache", nil);
          }
        }
      }
    }

    LiteRtLmEngine *engine = nullptr;
    NSString *resolvedBackend = nil;
    NSNumber *resolvedMaxNumTokens = nil;
    NSString *resolvedCacheMode = nil;
    NSString *resolvedCacheDirectory = nil;

    for (NSDictionary<NSString *, id> *attemptPlan in attemptPlans) {
      NSString *backend = attemptPlan[@"backend"];
      NSString *visionBackend = attemptPlan[@"visionBackend"];
      if ([visionBackend isEqualToString:@"none"]) {
        visionBackend = nil;
      }
      NSString *audioBackend = attemptPlan[@"audioBackend"];
      if ([audioBackend isEqualToString:@"none"]) {
        audioBackend = nil;
      }
      NSNumber *maxNumTokens = attemptPlan[@"maxNumTokens"];
      NSNumber *speculativeDecoding = attemptPlan[@"speculativeDecoding"];
      NSString *cacheMode = attemptPlan[@"cacheMode"];
      NSString *attemptCacheDirectory = attemptPlan[@"cacheDirectory"];

      LiteRtLmEngineSettings *settings = litert_lm_engine_settings_create(
          modelPath.fileSystemRepresentation, backend.UTF8String,
          visionBackend.length > 0 ? visionBackend.UTF8String : nullptr,
          audioBackend.length > 0 ? audioBackend.UTF8String : nullptr);
      if (settings == nullptr) {
        _lastLoadAttempts = [loadAttempts copy];
        if (error != nil) {
          *error = LiteRTLMError(LiteRTLMAdapterErrorModelLoadFailed,
                                 @"Failed to create LiteRT-LM engine settings.", @{
                                   @"modelPath" : modelPath ?: @"",
                                   @"runtimeConfig" : runtimeConfigDiagnostics,
                                   @"modelFileDiagnostics" : modelFileDiagnostics,
                                   @"loadAttempts" : loadAttempts
                                 });
        }
        return nullptr;
      }

      if (maxNumTokens != nil && maxNumTokens.intValue > 0) {
        litert_lm_engine_settings_set_max_num_tokens(settings, maxNumTokens.intValue);
      }

      if ([cacheMode isEqualToString:@"directory"]) {
        litert_lm_engine_settings_set_cache_dir(settings,
                                                attemptCacheDirectory.fileSystemRepresentation);
      } else {
        litert_lm_engine_settings_set_cache_dir(settings, ":nocache");
      }

      BOOL speculativeDecodingApiAvailable =
          litert_lm_engine_settings_set_enable_speculative_decoding != nullptr;
      if (speculativeDecodingApiAvailable) {
        litert_lm_engine_settings_set_enable_speculative_decoding(settings,
                                                                  speculativeDecoding.boolValue);
      }

      BOOL parallelFileSectionLoading =
          LiteRTLMParallelFileSectionLoadingFromRuntimeConfig(runtimeConfig);
      BOOL parallelFileSectionLoadingApiAvailable =
          litert_lm_engine_settings_set_parallel_file_section_loading != nullptr;
      if (parallelFileSectionLoadingApiAvailable) {
        litert_lm_engine_settings_set_parallel_file_section_loading(settings,
                                                                    parallelFileSectionLoading);
      }

      if (verboseNativeLogging) {
        NSLog(@"[LiteRTLMAdapter] Engine load attempt backend=%@ vision=%@ audio=%@ "
              @"maxNumTokens=%@ cacheMode=%@ speculative=%@",
              backend, visionBackend ?: @"none", audioBackend ?: @"none", maxNumTokens ?: @(0),
              cacheMode, speculativeDecoding.boolValue ? @"yes" : @"no");
      }
      LiteRtLmEngine *candidate = litert_lm_engine_create(settings);
      litert_lm_engine_settings_delete(settings);

      NSMutableDictionary<NSString *, id> *attemptResult = [attemptPlan mutableCopy];
      attemptResult[@"engineCreated"] = @(candidate != nullptr);
      attemptResult[@"speculativeDecoding"] = @(speculativeDecoding.boolValue);
      attemptResult[@"speculativeDecodingApiAvailable"] = @(speculativeDecodingApiAvailable);
      attemptResult[@"parallelFileSectionLoading"] = @(parallelFileSectionLoading);
      attemptResult[@"parallelFileSectionLoadingApiAvailable"] =
          @(parallelFileSectionLoadingApiAvailable);
      [loadAttempts addObject:attemptResult];

      if (candidate != nullptr) {
        engine = candidate;
        resolvedBackend = [backend copy];
        _loadedVisionBackend = [visionBackend copy];
        _loadedAudioBackend = [audioBackend copy];
        resolvedMaxNumTokens = [maxNumTokens copy];
        resolvedCacheMode = [cacheMode copy];
        resolvedCacheDirectory = [attemptCacheDirectory copy];
        break;
      }
    }

    if (engine == nullptr) {
      _lastLoadAttempts = [loadAttempts copy];
      if (error != nil) {
        *error = LiteRTLMError(LiteRTLMAdapterErrorModelLoadFailed,
                               @"LiteRT-LM failed to load the model file.", @{
                                 @"modelPath" : modelPath ?: @"",
                                 @"runtimeConfig" : runtimeConfigDiagnostics,
                                 @"modelFileDiagnostics" : modelFileDiagnostics,
                                 @"loadAttempts" : loadAttempts
                               });
      }
      return nullptr;
    }

    if (verboseNativeLogging && [resolvedCacheMode isEqualToString:@"nocache"]) {
      NSLog(@"[LiteRTLMAdapter] Loaded model after falling back to :nocache");
    }

    _engine = engine;
    _loadedModelPath = [modelPath copy];
    _loadedEngineConfigSignature = [requestedEngineConfigSignature copy];
    _loadedBackend = [resolvedBackend copy];
    _loadedMaxNumTokens = [resolvedMaxNumTokens copy];
    _loadedCacheMode = [resolvedCacheMode copy];
    _loadedCacheDirectory = [resolvedCacheDirectory copy];
    _lastLoadAttempts = [loadAttempts copy];
    return _engine;
  }
}

- (NSDictionary<NSString *, id> *)
    runInferenceWithModelPath:(NSString *)modelPath
                runtimeConfig:(NSDictionary<NSString *, id> *)runtimeConfig
                       prompt:(NSString *)prompt
                         goal:(NSString *)goal
               screenshotPath:(NSString *)screenshotPath
       planningScreenshotPath:(NSString *_Nullable)planningScreenshotPath
                  axNodeCount:(NSNumber *)axNodeCount
                        error:(NSError *_Nullable __autoreleasing *)error {
  const CFAbsoluteTime startedAt = CFAbsoluteTimeGetCurrent();
  BOOL verboseNativeLogging = LiteRTLMVerboseNativeLoggingFromRuntimeConfig(runtimeConfig);
  BOOL coldStart = NO;

  LiteRtLmEngine *engine = [self ensureEngineWithModelPath:modelPath
                                             runtimeConfig:runtimeConfig
                                              wasColdStart:&coldStart
                                                     error:error];
  if (engine == nullptr) {
    return nil;
  }

  NSMutableDictionary<NSString *, id> *runtimeDiagnostics =
      [LiteRTLMRuntimeConfigDiagnostics(runtimeConfig) mutableCopy];
  runtimeDiagnostics[@"modelPath"] = modelPath ?: @"";
  runtimeDiagnostics[@"backend"] = _loadedBackend ?: @"unknown";
  runtimeDiagnostics[@"visionBackend"] = _loadedVisionBackend ?: @"none";
  runtimeDiagnostics[@"audioBackend"] = _loadedAudioBackend ?: @"none";
  runtimeDiagnostics[@"maxNumTokens"] = _loadedMaxNumTokens ?: @(0);
  runtimeDiagnostics[@"cacheMode"] = _loadedCacheMode ?: @"unknown";
  runtimeDiagnostics[@"cacheDirectory"] = _loadedCacheDirectory ?: @"";
  runtimeDiagnostics[@"loadAttempts"] = _lastLoadAttempts ?: @[];

  // Validate screenshot file exists.
  if (screenshotPath.length == 0 ||
      ![[NSFileManager defaultManager] isReadableFileAtPath:screenshotPath]) {
    if (error != nil) {
      runtimeDiagnostics[@"screenshotPath"] = screenshotPath ?: @"";
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"Screenshot file is not readable.",
                             runtimeDiagnostics);
    }
    return nil;
  }

  NSDictionary<NSFileAttributeKey, id> *screenshotAttributes =
      [[NSFileManager defaultManager] attributesOfItemAtPath:screenshotPath error:nil];
  runtimeDiagnostics[@"screenshotBytes"] = screenshotAttributes[NSFileSize] ?: @(0);
  runtimeDiagnostics[@"viewportScreenshot"] = LiteRTLMCollectInputFileDiagnostics(screenshotPath);
  if (planningScreenshotPath.length > 0) {
    runtimeDiagnostics[@"planningScreenshot"] =
        LiteRTLMCollectInputFileDiagnostics(planningScreenshotPath);
  }

  // Build session and conversation config.
  LiteRtLmSessionConfig *sessionConfig = litert_lm_session_config_create();
  if (sessionConfig == nullptr) {
    if (error != nil) {
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"session_config_create=null",
                             runtimeDiagnostics);
    }
    return nil;
  }

  LiteRtLmSamplerParams samplerParams =
      LiteRTLMSamplerParamsFromRuntimeConfig(runtimeConfig);
  litert_lm_session_config_set_max_output_tokens(
      sessionConfig,
      (int)LiteRTLMMaxOutputTokensFromRuntimeConfig(runtimeConfig));
  litert_lm_session_config_set_sampler_params(sessionConfig, &samplerParams);

  // Build the tools JSON schema for the action contract. Even without
  // constrained decoding this helps the model understand the expected format.
  static NSString *toolsJSON = nil;
  static dispatch_once_t toolsOnce;
  dispatch_once(&toolsOnce, ^{
    NSDictionary<NSString *, id> *planUpdatesSchema = @{
      @"type": @"array",
      @"description": @"Optional bounded plan mutations for the runtime to validate before commit.",
      @"items": @{
        @"type": @"object",
        @"properties": @{
          @"type": @{
            @"type": @"string",
            @"description": @"Plan mutation type",
            @"enum": @[ @"add_item", @"set_active_item", @"complete_item", @"reopen_item", @"drop_item", @"set_phase" ]
          },
          @"id": @{ @"type": @"string", @"description": @"Existing todo ID for non-add mutations" },
          @"text": @{ @"type": @"string", @"description": @"Todo text for add_item" },
          @"activate": @{ @"type": @"boolean", @"description": @"Whether add_item should become active immediately" },
          @"phase": @{ @"type": @"string", @"description": @"Target phase for set_phase" },
          @"evidence": @{ @"type": @"string", @"description": @"Short supporting evidence string" },
          @"reason": @{ @"type": @"string", @"description": @"Short reason for drop_item or related updates" },
        },
        @"required": @[ @"type" ]
      }
    };

    // Gemma 4 Jinja template expects each tool wrapped in {"function": {...}}.
    NSArray<NSDictionary<NSString *, id> *> *tools = @[
      @{ @"function": @{ @"name": @"click", @"description": @"Click an element by accessibility ID",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element accessibility ID" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"id" ] } } },
      @{ @"function": @{ @"name": @"tap_coordinates", @"description": @"Tap at screen coordinates",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"x": @{ @"type": @"number", @"description": @"X coordinate" },
          @"y": @{ @"type": @"number", @"description": @"Y coordinate" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"x", @"y" ] } } },
      @{ @"function": @{ @"name": @"type", @"description": @"Type text into an input element (appends)",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element ref ID" },
          @"text": @{ @"type": @"string", @"description": @"Text to type" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"id", @"text" ] } } },
      @{ @"function": @{ @"name": @"fill", @"description": @"Clear input field and set new text",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element ref ID" },
          @"text": @{ @"type": @"string", @"description": @"Text to fill" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"id", @"text" ] } } },
      @{ @"function": @{ @"name": @"select", @"description": @"Pick a dropdown option by value or visible text",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Select element ref ID" },
          @"value": @{ @"type": @"string", @"description": @"Option value or visible text" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"id", @"value" ] } } },
      @{ @"function": @{ @"name": @"gettext", @"description": @"Read the text content of an element",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element ref ID" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"id" ] } } },
      @{ @"function": @{ @"name": @"hover", @"description": @"Hover over an element to trigger menus or tooltips",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element ref ID" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"id" ] } } },
      @{ @"function": @{ @"name": @"focus", @"description": @"Focus an element",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element ref ID" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"id" ] } } },
      @{ @"function": @{ @"name": @"eval", @"description": @"Run JavaScript in the page and return the result",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"code": @{ @"type": @"string", @"description": @"JavaScript code to execute" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"code" ] } } },
      @{ @"function": @{ @"name": @"scroll", @"description": @"Scroll the page",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"direction": @{ @"type": @"string", @"description": @"up, down, left, or right" },
          @"amount": @{ @"type": @"string", @"description": @"page, half, or small" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"direction", @"amount" ] } } },
      @{ @"function": @{ @"name": @"go_back", @"description": @"Navigate back",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"plan_updates": planUpdatesSchema } } } },
      @{ @"function": @{ @"name": @"wait", @"description": @"Wait for a condition: idle, url:<pattern>, selector:<css>, text:<substring>",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"condition": @{ @"type": @"string", @"description": @"idle, url:<pattern>, selector:<css>, or text:<substring>" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"condition" ] } } },
      @{ @"function": @{ @"name": @"yield_to_user", @"description": @"Ask the user for help",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"reason": @{ @"type": @"string", @"description": @"Why user input is needed" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"reason" ] } } },
      @{ @"function": @{ @"name": @"finish", @"description": @"Task is complete",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"status": @{ @"type": @"string", @"description": @"success or failure" },
          @"message": @{ @"type": @"string", @"description": @"Summary of outcome" },
          @"plan_updates": planUpdatesSchema },
          @"required": @[ @"status", @"message" ] } } },
    ];
    NSData *data = [NSJSONSerialization dataWithJSONObject:tools options:0 error:nil];
    toolsJSON = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  });

  // Build system message for structured output.
  static NSString *systemMessageJSON = nil;
  static dispatch_once_t systemOnce;
  dispatch_once(&systemOnce, ^{
    NSDictionary<NSString *, id> *systemMessage = @{
      @"role": @"system",
      @"content": @"You are a browser automation agent. You see a screenshot of a webpage and an accessibility tree. "
                   "You may receive one or two images. The first is the current viewport. If present, the second is a full-page overview of the same page for planning. "
                   "Decide the single best next action to achieve the user's goal. "
                   "Respond with exactly one JSON object: {\"action\": \"<name>\", \"parameters\": {<params>}, \"plan_updates\": [optional bounded updates]}. "
                   "Do not include any text outside the JSON."
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:systemMessage options:0 error:nil];
    systemMessageJSON = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  });

  // Build multimodal conversation message with screenshot file path + prompt.
  // LiteRT-LM's LoadItemData accepts {"type":"image","path":"..."} and
  // memory-maps the file directly — no base64 encoding needed.
  NSMutableArray<NSDictionary<NSString *, id> *> *content = [NSMutableArray arrayWithObject:
    @{ @"type": @"image", @"path": screenshotPath }
  ];
  if (planningScreenshotPath.length > 0) {
    [content addObject:@{ @"type": @"image", @"path": planningScreenshotPath }];
  }
  [content addObject:@{ @"type": @"text", @"text": prompt }];

  NSDictionary<NSString *, id> *message = @{
    @"role": @"user",
    @"content": content,
  };

  NSData *messageData = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  if (messageData == nil) {
    litert_lm_session_config_delete(sessionConfig);
    if (error != nil) {
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"Failed to serialize inference message JSON.",
                             runtimeDiagnostics);
    }
    return nil;
  }
  NSString *messageJSON = [[NSString alloc] initWithData:messageData encoding:NSUTF8StringEncoding];

  if (verboseNativeLogging) {
    NSLog(@"[LiteRTLMAdapter] runInference: creating conversation (screenshot=%@, prompt=%luC, tools=%@)",
          runtimeDiagnostics[@"screenshotBytes"], (unsigned long)prompt.length,
          toolsJSON != nil ? @"yes" : @"no");
  }

  // Pass system message and tools schema to the conversation config.
  // Constrained decoding is disabled because our xcframework has stub
  // constraint provider symbols. The tools schema still helps the model
  // understand the expected output format via the prompt context.
  LiteRtLmConversationConfig *conversationConfig =
      LiteRTLMConversationConfigCreate(
          engine,
          sessionConfig,
          systemMessageJSON ? systemMessageJSON.UTF8String : nullptr,
          toolsJSON ? toolsJSON.UTF8String : nullptr,
          nullptr,
          false);
  litert_lm_session_config_delete(sessionConfig);

  if (conversationConfig == nullptr) {
    if (error != nil) {
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"conversation_config_create=null",
                             runtimeDiagnostics);
    }
    return nil;
  }

  LiteRtLmConversation *conversation =
      litert_lm_conversation_create(engine, conversationConfig);
  litert_lm_conversation_config_delete(conversationConfig);

  if (conversation == nullptr) {
    if (error != nil) {
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"conversation_create=null",
                             runtimeDiagnostics);
    }
    return nil;
  }

  if (verboseNativeLogging) {
    NSLog(@"[LiteRTLMAdapter] runInference: sending multimodal message");
  }

  LiteRtLmJsonResponse *jsonResponse =
      litert_lm_conversation_send_message(conversation, messageJSON.UTF8String, nullptr);

  if (jsonResponse == nullptr) {
    litert_lm_conversation_delete(conversation);
    if (planningScreenshotPath.length > 0) {
      NSDictionary<NSString *, id> *probeResults = @{
        @"both": LiteRTLMProbeConversationSend(
            engine,
            runtimeConfig,
            systemMessageJSON,
            toolsJSON,
            prompt,
            @[ screenshotPath, planningScreenshotPath ],
            @"both"),
        @"viewport_only": LiteRTLMProbeConversationSend(
            engine,
            runtimeConfig,
            systemMessageJSON,
            toolsJSON,
            prompt,
            @[ screenshotPath ],
            @"viewport_only"),
        @"full_page_only": LiteRTLMProbeConversationSend(
            engine,
            runtimeConfig,
            systemMessageJSON,
            toolsJSON,
            prompt,
            @[ planningScreenshotPath ],
            @"full_page_only")
      };
      runtimeDiagnostics[@"multimodalProbe"] = probeResults;
      if (verboseNativeLogging) {
        NSLog(@"[LiteRTLMAdapter] multimodal failure probe=%@", probeResults);
      }
    }
    if (error != nil) {
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"conversation_send_message=null",
                             runtimeDiagnostics);
    }
    return nil;
  }

  const char *responseCString = litert_lm_json_response_get_string(jsonResponse);
  NSString *responseJSONString = responseCString != nullptr
      ? [NSString stringWithUTF8String:responseCString] : nil;
  id responseObject = LiteRTLMParseJSONObjectFromUTF8(responseCString);

  litert_lm_json_response_delete(jsonResponse);
  litert_lm_conversation_delete(conversation);

  if (verboseNativeLogging) {
    NSLog(@"[LiteRTLMAdapter] runInference: raw model output=%@", responseJSONString ?: @"null");
  }

  if (![responseObject isKindOfClass:[NSDictionary class]]) {
    if (error != nil) {
      NSMutableDictionary<NSString *, id> *details = [runtimeDiagnostics mutableCopy];
      details[@"rawModelOutput"] = responseJSONString ?: @"";
      details[@"failureClass"] = @"invalid_json";
      *error = LiteRTLMError(LiteRTLMAdapterErrorInvalidResponse,
                             @"Model returned unparseable response.",
                             details);
    }
    return nil;
  }

  NSDictionary<NSString *, id> *responseDictionary = (NSDictionary<NSString *, id> *)responseObject;
  NSString *action = nil;
  NSDictionary<NSString *, id> *parameters = nil;
  NSArray<NSDictionary<NSString *, id> *> *planUpdates = nil;

  // Parse Gemma 4 native tool_calls format:
  // {"role":"assistant","tool_calls":[{"type":"function","function":{"name":"...","arguments":{...}}}]}
  NSArray<NSDictionary<NSString *, id> *> *toolCalls = responseDictionary[@"tool_calls"];
  if ([toolCalls isKindOfClass:[NSArray class]] && toolCalls.count > 0) {
    NSDictionary<NSString *, id> *firstCall = toolCalls.firstObject;
    if ([firstCall isKindOfClass:[NSDictionary class]]) {
      NSDictionary<NSString *, id> *function = firstCall[@"function"];
      if ([function isKindOfClass:[NSDictionary class]]) {
        action = function[@"name"];
        NSDictionary<NSString *, id> *rawArguments = function[@"arguments"];
        if ([rawArguments isKindOfClass:[NSDictionary class]]) {
          // Strip Gemma's <|"|> quote markers from string values.
          NSMutableDictionary<NSString *, id> *cleaned = [NSMutableDictionary dictionary];
          for (NSString *key in rawArguments) {
            id value = rawArguments[key];
            if ([value isKindOfClass:[NSString class]]) {
              NSString *str = (NSString *)value;
              str = [str stringByReplacingOccurrencesOfString:@"<|\"|>" withString:@""];
              cleaned[key] = str;
            } else {
              cleaned[key] = value;
            }
          }
          id rawPlanUpdates = cleaned[@"plan_updates"];
          if ([rawPlanUpdates isKindOfClass:[NSArray class]]) {
            planUpdates = (NSArray<NSDictionary<NSString *, id> *> *)rawPlanUpdates;
            [cleaned removeObjectForKey:@"plan_updates"];
          }
          parameters = cleaned;
        }
      }
    }
  }

  // Fallback: try {"action":"...", "parameters":{...}} format.
  if (action == nil) {
    action = responseDictionary[@"action"];
    parameters = responseDictionary[@"parameters"];
    if ([responseDictionary[@"plan_updates"] isKindOfClass:[NSArray class]]) {
      planUpdates = (NSArray<NSDictionary<NSString *, id> *> *)responseDictionary[@"plan_updates"];
    }

    // Also try extracting text content and parsing as JSON.
    if (action == nil) {
      NSString *extractedText = LiteRTLMExtractTextFromResponseObject(responseObject);
      NSString *textCandidate = [extractedText stringByTrimmingCharactersInSet:
          [NSCharacterSet whitespaceAndNewlineCharacterSet]];
      if (textCandidate.length > 0) {
        // Strip code fences.
        if ([textCandidate hasPrefix:@"```"]) {
          NSRange firstNewline = [textCandidate rangeOfString:@"\n"];
          NSRange lastFence = [textCandidate rangeOfString:@"```" options:NSBackwardsSearch];
          if (firstNewline.location != NSNotFound && lastFence.location > firstNewline.location) {
            textCandidate = [textCandidate substringWithRange:
                NSMakeRange(firstNewline.location + 1,
                            lastFence.location - firstNewline.location - 1)];
            textCandidate = [textCandidate stringByTrimmingCharactersInSet:
                [NSCharacterSet whitespaceAndNewlineCharacterSet]];
          }
        }
        NSData *textData = [textCandidate dataUsingEncoding:NSUTF8StringEncoding];
        id textObject = textData != nil
            ? [NSJSONSerialization JSONObjectWithData:textData options:0 error:nil] : nil;
        if ([textObject isKindOfClass:[NSDictionary class]]) {
          action = ((NSDictionary *)textObject)[@"action"];
          parameters = ((NSDictionary *)textObject)[@"parameters"];
          if ([((NSDictionary *)textObject)[@"plan_updates"] isKindOfClass:[NSArray class]]) {
            planUpdates = ((NSDictionary *)textObject)[@"plan_updates"];
          }
        }
      }

      // Fallback: parse <|tool_call>call:name{key:value,...} format that Gemma
      // sometimes emits in text content instead of a proper tool_calls array.
      if (action == nil && textCandidate.length > 0) {
        NSRange callRange = [textCandidate rangeOfString:@"call:"];
        if (callRange.location != NSNotFound) {
          NSString *afterCall = [textCandidate substringFromIndex:
              callRange.location + callRange.length];
          // Extract function name (everything before first '{' or end of string).
          NSRange braceRange = [afterCall rangeOfString:@"{"];
          if (braceRange.location != NSNotFound) {
            action = [[afterCall substringToIndex:braceRange.location]
                stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            // Extract arguments between first '{' and matching '}'.
            NSString *argsRaw = [afterCall substringFromIndex:braceRange.location];
            // Try to find key:value pairs and build a dictionary.
            // Format: {key1:value1,key2:value2} or {key1:<|"|>value<|"|>}
            NSMutableDictionary *parsedParams = [NSMutableDictionary dictionary];
            NSString *inner = argsRaw;
            if ([inner hasPrefix:@"{"]) {
              NSRange closeRange = [inner rangeOfString:@"}" options:NSBackwardsSearch];
              if (closeRange.location != NSNotFound) {
                inner = [inner substringWithRange:NSMakeRange(1, closeRange.location - 1)];
              } else {
                inner = [inner substringFromIndex:1];
              }
            }
            // Clean Gemma quote markers.
            inner = [inner stringByReplacingOccurrencesOfString:@"<|\"|>" withString:@""];
            inner = [inner stringByReplacingOccurrencesOfString:@"<|\"|>" withString:@""];
            // Split by comma, then by first colon.
            NSArray<NSString *> *pairs = [inner componentsSeparatedByString:@","];
            for (NSString *pair in pairs) {
              NSRange colonRange = [pair rangeOfString:@":"];
              if (colonRange.location != NSNotFound && colonRange.location > 0) {
                NSString *key = [[pair substringToIndex:colonRange.location]
                    stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
                NSString *val = [[pair substringFromIndex:colonRange.location + 1]
                    stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
                if (key.length > 0) {
                  parsedParams[key] = val;
                }
              }
            }
            parameters = parsedParams;
          }
        }
      }
    }
  }

  if (![action isKindOfClass:[NSString class]] || ((NSString *)action).length == 0) {
    if (error != nil) {
      NSMutableDictionary<NSString *, id> *details = [runtimeDiagnostics mutableCopy];
      details[@"rawModelOutput"] = responseJSONString ?: @"";
      details[@"parsedKeys"] = [responseDictionary allKeys] ?: @[];
      details[@"failureClass"] = @"missing_action";
      *error = LiteRTLMError(LiteRTLMAdapterErrorInvalidResponse,
                             @"Could not extract action from model response.",
                             details);
    }
    return nil;
  }

  if (![parameters isKindOfClass:[NSDictionary class]]) {
    parameters = @{};
  }

  NSNumber *elapsedMs = @((CFAbsoluteTimeGetCurrent() - startedAt) * 1000.0);
  runtimeDiagnostics[@"coldStart"] = @(coldStart);
  runtimeDiagnostics[@"elapsedMs"] = elapsedMs;
  runtimeDiagnostics[@"apiPath"] = @"conversation";

  if (verboseNativeLogging) {
    NSLog(@"[LiteRTLMAdapter] runInference: action=%@ elapsed=%.0fms", action, elapsedMs.doubleValue);
  }

  return @{
    @"action": action,
    @"parameters": parameters,
    @"planUpdates": planUpdates ?: NSNull.null,
    @"diagnostics": runtimeDiagnostics,
  };
}

- (NSDictionary<NSString *, id> *)runTextSmokeTestWithModelPath:(NSString *)modelPath
                                                  runtimeConfig:(NSDictionary<NSString *, id> *)runtimeConfig
                                                         prompt:(NSString *)prompt
                                                          error:(NSError * _Nullable __autoreleasing *)error {
  NSString *trimmedPrompt = [prompt stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmedPrompt.length == 0) {
    if (error != nil) {
      NSDictionary<NSString *, id> *details = @{ @"modelPath": modelPath ?: @"" };
      LiteRTLMLogSmokeTestFailure(@"invalid_prompt", @"Smoke test prompt must not be empty.", details);
      *error = LiteRTLMError(LiteRTLMAdapterErrorInvalidResponse,
                             @"Smoke test prompt must not be empty.",
                             details);
    }
    return nil;
  }

  const CFAbsoluteTime startedAt = CFAbsoluteTimeGetCurrent();
  BOOL coldStart = NO;
  BOOL verboseNativeLogging =
      LiteRTLMVerboseNativeLoggingFromRuntimeConfig(runtimeConfig);
  LiteRtLmEngine *engine = [self ensureEngineWithModelPath:modelPath
                                             runtimeConfig:runtimeConfig
                                              wasColdStart:&coldStart
                                                     error:error];
  if (engine == nullptr) {
    LiteRTLMLogSmokeTestFailure(@"engine_load", @"ensureEngineWithModelPath returned null.", @{
      @"modelPath" : modelPath ?: @"",
      @"runtimeConfig" : LiteRTLMRuntimeConfigDiagnostics(runtimeConfig)
    });
    return nil;
  }

  NSMutableDictionary<NSString *, id> *runtimeDiagnostics =
      [LiteRTLMRuntimeConfigDiagnostics(runtimeConfig) mutableCopy];
  runtimeDiagnostics[@"modelPath"] = modelPath ?: @"";
  runtimeDiagnostics[@"backend"] = _loadedBackend ?: @"unknown";
  runtimeDiagnostics[@"visionBackend"] = _loadedVisionBackend ?: @"none";
  runtimeDiagnostics[@"audioBackend"] = _loadedAudioBackend ?: @"none";
  runtimeDiagnostics[@"maxNumTokens"] = _loadedMaxNumTokens ?: @(0);
  runtimeDiagnostics[@"cacheMode"] = _loadedCacheMode ?: @"unknown";
  runtimeDiagnostics[@"cacheDirectory"] = _loadedCacheDirectory ?: @"";
  runtimeDiagnostics[@"loadAttempts"] = _lastLoadAttempts ?: @[];

  // Try Conversation API first — it applies the model's chat template
  // (e.g. <start_of_turn>user\n...) automatically. Without this formatting,
  // the model immediately produces a stop token and returns empty text.
  LiteRtLmSessionConfig *sessionConfig = litert_lm_session_config_create();
  if (sessionConfig == nullptr) {
    if (error != nil) {
      LiteRTLMLogSmokeTestFailure(@"session_config_create",
                                  @"session_config_create=null",
                                  runtimeDiagnostics);
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"session_config_create=null",
                             runtimeDiagnostics);
    }
    return nil;
  }

  LiteRtLmSamplerParams samplerParams =
      LiteRTLMSamplerParamsFromRuntimeConfig(runtimeConfig);
  litert_lm_session_config_set_max_output_tokens(
      sessionConfig,
      (int)LiteRTLMMaxOutputTokensFromRuntimeConfig(runtimeConfig));
  litert_lm_session_config_set_sampler_params(sessionConfig, &samplerParams);

  // --- Conversation API path (preferred) ---
  if (verboseNativeLogging) {
    NSLog(@"[LiteRTLMAdapter] Trying Conversation API (engine=%p)", engine);
  }
  LiteRtLmConversationConfig *conversationConfig =
      LiteRTLMConversationConfigCreate(engine, sessionConfig, nullptr, nullptr, nullptr, false);

  if (conversationConfig != nullptr) {
    LiteRtLmConversation *conversation =
        litert_lm_conversation_create(engine, conversationConfig);
    litert_lm_conversation_config_delete(conversationConfig);

    if (conversation != nullptr) {
      if (verboseNativeLogging) {
        NSLog(@"[LiteRTLMAdapter] Conversation created, sending message");
      }

      NSDictionary<NSString *, id> *message = @{
        @"role": @"user",
        @"content": @[ @{ @"type": @"text", @"text": trimmedPrompt } ],
      };
      NSData *messageData = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
      NSString *messageJSON = [[NSString alloc] initWithData:messageData encoding:NSUTF8StringEncoding];

      LiteRtLmJsonResponse *jsonResponse =
          litert_lm_conversation_send_message(conversation, messageJSON.UTF8String, nullptr);

      if (jsonResponse != nullptr) {
        const char *responseCString = litert_lm_json_response_get_string(jsonResponse);
        NSString *responseJSONString = responseCString != nullptr
            ? [NSString stringWithUTF8String:responseCString] : nil;
        id responseObject = LiteRTLMParseJSONObjectFromUTF8(responseCString);
        NSString *extractedText = LiteRTLMExtractTextFromResponseObject(responseObject);

        litert_lm_json_response_delete(jsonResponse);
        litert_lm_conversation_delete(conversation);
        litert_lm_session_config_delete(sessionConfig);

        NSString *resolvedText = [extractedText stringByTrimmingCharactersInSet:
            [NSCharacterSet whitespaceAndNewlineCharacterSet]];
        if (resolvedText.length == 0 && responseJSONString != nil) {
          resolvedText = [responseJSONString stringByTrimmingCharactersInSet:
              [NSCharacterSet whitespaceAndNewlineCharacterSet]];
        }

        if (resolvedText.length > 0) {
          NSNumber *elapsedMs = @((CFAbsoluteTimeGetCurrent() - startedAt) * 1000.0);
          runtimeDiagnostics[@"coldStart"] = @(coldStart);
          runtimeDiagnostics[@"elapsedMs"] = elapsedMs;
          runtimeDiagnostics[@"apiPath"] = @"conversation";
          NSLog(@"[LiteRTLMAdapter] Smoke test succeeded (conversation) diagnostics=%@", runtimeDiagnostics);
          return @{ @"text": resolvedText, @"diagnostics": runtimeDiagnostics };
        }

        // Conversation returned but text was empty — log and fall through to Session API
        if (verboseNativeLogging) {
          NSLog(@"[LiteRTLMAdapter] Conversation returned empty text, rawJSON=%@", responseJSONString ?: @"null");
        }
      } else {
        litert_lm_conversation_delete(conversation);
        if (verboseNativeLogging) {
          NSLog(@"[LiteRTLMAdapter] conversation_send_message returned null");
        }
      }
    } else {
      if (verboseNativeLogging) {
        NSLog(@"[LiteRTLMAdapter] conversation_create returned null, falling back to Session API");
      }
    }
  } else {
    if (verboseNativeLogging) {
      NSLog(@"[LiteRTLMAdapter] conversation_config_create returned null, falling back to Session API");
    }
  }

  // --- Session API fallback ---
  if (verboseNativeLogging) {
    NSLog(@"[LiteRTLMAdapter] Falling back to Session API (engine=%p)", engine);
  }
  LiteRtLmSession *session = litert_lm_engine_create_session(engine, sessionConfig);
  litert_lm_session_config_delete(sessionConfig);

  if (session == nullptr) {
    if (error != nil) {
      LiteRTLMLogSmokeTestFailure(@"engine_create_session",
                                  @"engine_create_session=null",
                                  runtimeDiagnostics);
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"engine_create_session=null",
                             runtimeDiagnostics);
    }
    return nil;
  }

  if (verboseNativeLogging) {
    NSLog(@"[LiteRTLMAdapter] Session created, generating content");
  }
  LiteRtLmResponses *responses = LiteRTLMGenerateText(session, trimmedPrompt);
  if (responses == nullptr) {
    litert_lm_session_delete(session);
    if (error != nil) {
      LiteRTLMLogSmokeTestFailure(@"generate_content",
                                  @"generate_content=null",
                                  runtimeDiagnostics);
      *error = LiteRTLMError(LiteRTLMAdapterErrorExecutionFailed,
                             @"generate_content=null",
                             runtimeDiagnostics);
    }
    return nil;
  }

  int numCandidates = litert_lm_responses_get_num_candidates(responses);
  if (verboseNativeLogging) {
    NSLog(@"[LiteRTLMAdapter] Got %d candidates", numCandidates);
  }

  NSString *responseText = nil;
  if (numCandidates > 0) {
    const char *text = litert_lm_responses_get_response_text_at(responses, 0);
    if (text != nullptr) {
      responseText = [NSString stringWithUTF8String:text];
    }
  }

  litert_lm_responses_delete(responses);
  litert_lm_session_delete(session);

  NSString *resolvedText = [responseText stringByTrimmingCharactersInSet:
      [NSCharacterSet whitespaceAndNewlineCharacterSet]];

  if (resolvedText.length == 0) {
    if (error != nil) {
      NSMutableDictionary<NSString *, id> *invalidResponseDetails =
          [runtimeDiagnostics mutableCopy];
      invalidResponseDetails[@"rawResponse"] = responseText ?: @"";
      LiteRTLMLogSmokeTestFailure(@"empty_text",
                                  [NSString stringWithFormat:@"candidates=%d, text=empty", numCandidates],
                                  invalidResponseDetails);
      *error = LiteRTLMError(LiteRTLMAdapterErrorInvalidResponse,
                             [NSString stringWithFormat:@"candidates=%d, text=empty", numCandidates],
                             invalidResponseDetails);
    }
    return nil;
  }

  NSNumber *elapsedMilliseconds = @((CFAbsoluteTimeGetCurrent() - startedAt) * 1000.0);

  runtimeDiagnostics[@"coldStart"] = @(coldStart);
  runtimeDiagnostics[@"elapsedMs"] = elapsedMilliseconds;
  runtimeDiagnostics[@"apiPath"] = @"session";
  runtimeDiagnostics[@"candidates"] = @(numCandidates);
  NSLog(@"[LiteRTLMAdapter] Smoke test succeeded diagnostics=%@", runtimeDiagnostics);

  return @{
    @"text": resolvedText,
    @"diagnostics": runtimeDiagnostics,
  };
}

@end
