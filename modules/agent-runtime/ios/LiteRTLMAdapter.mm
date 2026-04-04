#import "LiteRTLMAdapter.h"
#import "Vendor/LiteRTLM/include/engine.h"
#include <string.h>

static NSString *const LiteRTLMAdapterErrorDomain = @"AgentRuntimeLiteRTLMAdapter";

typedef NS_ENUM(NSInteger, LiteRTLMAdapterErrorCode) {
  LiteRTLMAdapterErrorRuntimeUnavailable = 501,
  LiteRTLMAdapterErrorModelLoadFailed = 502,
  LiteRTLMAdapterErrorExecutionFailed = 503,
  LiteRTLMAdapterErrorInvalidResponse = 504,
};

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

static NSString *LiteRTLMSamplerTypeName(Type samplerType) {
  switch (samplerType) {
    case kTopK:
      return @"top_k";
    case kGreedy:
      return @"greedy";
    case kTopP:
    case kTypeUnspecified:
    default:
      return @"top_p";
  }
}

static LiteRtLmSamplerParams LiteRTLMSamplerParamsFromRuntimeConfig(
    NSDictionary<NSString *, id> *runtimeConfig) {
  LiteRtLmSamplerParams samplerParams = {};
  samplerParams.type = kTopP;
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
      samplerParams.type = kTopK;
    } else if ([samplerType isEqualToString:@"greedy"]) {
      samplerParams.type = kGreedy;
    } else {
      samplerParams.type = kTopP;
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
    @"requestedMaxNumTokens": @(LiteRTLMMaxNumTokensFromRuntimeConfig(runtimeConfig)),
    @"requestedMaxOutputTokens": @(LiteRTLMMaxOutputTokensFromRuntimeConfig(runtimeConfig)),
    @"requestedSampler": @{
      @"type": LiteRTLMSamplerTypeName(samplerParams.type),
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
  return [NSString stringWithFormat:@"backends=%@|maxTokens=%ld",
                                    [preferredBackends componentsJoinedByString:@","],
                                    (long)LiteRTLMMaxNumTokensFromRuntimeConfig(runtimeConfig)];
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
  NSNumber *_Nullable _loadedMaxNumTokens;
  NSString *_Nullable _loadedCacheMode;
  NSString *_Nullable _loadedCacheDirectory;
}
@end

@implementation LiteRTLMAdapter

- (void)dealloc {
  @synchronized (self) {
    if (_engine != nullptr) {
      litert_lm_engine_delete(_engine);
      _engine = nullptr;
    }
  }
}

- (nullable LiteRtLmEngine *)ensureEngineWithModelPath:(NSString *)modelPath
                                         runtimeConfig:(NSDictionary<NSString *, id> *)runtimeConfig
                                          wasColdStart:(BOOL *)wasColdStart
                                                 error:(NSError * _Nullable * _Nullable)error {
  @synchronized (self) {
    NSString *requestedEngineConfigSignature =
        LiteRTLMEngineConfigSignature(runtimeConfig);
    const BOOL needsReload = (_engine == nullptr ||
        ![_loadedModelPath isEqualToString:modelPath] ||
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
      _loadedMaxNumTokens = nil;
      _loadedCacheMode = nil;
      _loadedCacheDirectory = nil;
    }

    BOOL verboseNativeLogging =
        LiteRTLMVerboseNativeLoggingFromRuntimeConfig(runtimeConfig);
    if (verboseNativeLogging) {
      NSLog(@"[LiteRTLMAdapter] Loading model from: %@", modelPath);
    }
    litert_lm_set_min_log_level(verboseNativeLogging ? 0 : 1);

    NSDictionary<NSString *, id> *runtimeConfigDiagnostics =
        LiteRTLMRuntimeConfigDiagnostics(runtimeConfig);
    NSDictionary<NSString *, id> *modelFileDiagnostics =
        LiteRTLMCollectModelFileDiagnostics(modelPath);
    NSMutableArray<NSDictionary<NSString *, id> *> *loadAttempts =
        [NSMutableArray array];

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
    NSNumber *configuredMaxNumTokens =
        @(LiteRTLMMaxNumTokensFromRuntimeConfig(runtimeConfig));
    NSMutableArray<NSDictionary<NSString *, id> *> *attemptPlans =
        [NSMutableArray array];
    if (cacheDirectoryReady) {
      for (NSString *backend in preferredBackends) {
        [attemptPlans addObject:@{
          @"backend": backend,
          @"maxNumTokens": configuredMaxNumTokens,
          @"cacheMode": @"directory",
          @"cacheDirectory": cacheDirectory
        }];
        [attemptPlans addObject:@{
          @"backend": backend,
          @"maxNumTokens": configuredMaxNumTokens,
          @"cacheMode": @"nocache"
        }];
      }
    } else {
      [loadAttempts addObject:@{
        @"backend": @"*",
        @"maxNumTokens": configuredMaxNumTokens,
        @"cacheMode": @"directory",
        @"cacheDirectory": cacheDirectory,
        @"engineCreated": @NO,
        @"skipped": @YES,
        @"cacheDirectoryError": cacheDirectoryError.localizedDescription ?: @"unknown",
        @"preferredBackends": preferredBackends
      }];
      for (NSString *backend in preferredBackends) {
        [attemptPlans addObject:@{
          @"backend": backend,
          @"maxNumTokens": configuredMaxNumTokens,
          @"cacheMode": @"nocache"
        }];
      }
    }

    LiteRtLmEngine *engine = nullptr;
    NSString *resolvedBackend = nil;
    NSNumber *resolvedMaxNumTokens = nil;
    NSString *resolvedCacheMode = nil;
    NSString *resolvedCacheDirectory = nil;

    for (NSDictionary<NSString *, id> *attemptPlan in attemptPlans) {
      NSString *backend = attemptPlan[@"backend"];
      NSNumber *maxNumTokens = attemptPlan[@"maxNumTokens"];
      NSString *cacheMode = attemptPlan[@"cacheMode"];
      NSString *attemptCacheDirectory = attemptPlan[@"cacheDirectory"];

      LiteRtLmEngineSettings *settings = litert_lm_engine_settings_create(
          modelPath.fileSystemRepresentation,
          backend.UTF8String,
          backend.UTF8String,
          nullptr);
      if (settings == nullptr) {
        if (error != nil) {
          *error = LiteRTLMError(
              LiteRTLMAdapterErrorModelLoadFailed,
              @"Failed to create LiteRT-LM engine settings.",
              @{
                @"modelPath": modelPath ?: @"",
                @"runtimeConfig": runtimeConfigDiagnostics,
                @"modelFileDiagnostics": modelFileDiagnostics,
                @"loadAttempts": loadAttempts
              });
        }
        return nullptr;
      }

      if (maxNumTokens != nil && maxNumTokens.intValue > 0) {
        litert_lm_engine_settings_set_max_num_tokens(settings, maxNumTokens.intValue);
      }

      if ([cacheMode isEqualToString:@"directory"]) {
        litert_lm_engine_settings_set_cache_dir(
            settings, attemptCacheDirectory.fileSystemRepresentation);
      } else {
        litert_lm_engine_settings_set_cache_dir(settings, ":nocache");
      }

      if (verboseNativeLogging) {
        NSLog(@"[LiteRTLMAdapter] Engine load attempt backend=%@ maxNumTokens=%@ cacheMode=%@",
              backend,
              maxNumTokens ?: @(0),
              cacheMode);
      }
      LiteRtLmEngine *candidate = litert_lm_engine_create(settings);
      litert_lm_engine_settings_delete(settings);

      NSMutableDictionary<NSString *, id> *attemptResult =
          [attemptPlan mutableCopy];
      attemptResult[@"engineCreated"] = @(candidate != nullptr);
      [loadAttempts addObject:attemptResult];

      if (candidate != nullptr) {
        engine = candidate;
        resolvedBackend = [backend copy];
        resolvedMaxNumTokens = [maxNumTokens copy];
        resolvedCacheMode = [cacheMode copy];
        resolvedCacheDirectory = [attemptCacheDirectory copy];
        break;
      }
    }

    if (engine == nullptr) {
      if (error != nil) {
        *error = LiteRTLMError(
            LiteRTLMAdapterErrorModelLoadFailed,
            @"LiteRT-LM failed to load the model file.",
            @{
              @"modelPath": modelPath ?: @"",
              @"runtimeConfig": runtimeConfigDiagnostics,
              @"modelFileDiagnostics": modelFileDiagnostics,
              @"loadAttempts": loadAttempts
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
    return _engine;
  }
}

- (NSDictionary<NSString *, id> *)runInferenceWithModelPath:(NSString *)modelPath
                                              runtimeConfig:(NSDictionary<NSString *, id> *)runtimeConfig
                                                     prompt:(NSString *)prompt
                                                       goal:(NSString *)goal
                                             screenshotPath:(NSString *)screenshotPath
                                                axNodeCount:(NSNumber *)axNodeCount
                                                      error:(NSError * _Nullable __autoreleasing *)error {
  const CFAbsoluteTime startedAt = CFAbsoluteTimeGetCurrent();
  BOOL verboseNativeLogging =
      LiteRTLMVerboseNativeLoggingFromRuntimeConfig(runtimeConfig);
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
  runtimeDiagnostics[@"maxNumTokens"] = _loadedMaxNumTokens ?: @(0);

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
    // Gemma 4 Jinja template expects each tool wrapped in {"function": {...}}.
    NSArray<NSDictionary<NSString *, id> *> *tools = @[
      @{ @"function": @{ @"name": @"click", @"description": @"Click an element by accessibility ID",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element accessibility ID" } },
          @"required": @[ @"id" ] } } },
      @{ @"function": @{ @"name": @"tap_coordinates", @"description": @"Tap at screen coordinates",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"x": @{ @"type": @"number", @"description": @"X coordinate" },
          @"y": @{ @"type": @"number", @"description": @"Y coordinate" } },
          @"required": @[ @"x", @"y" ] } } },
      @{ @"function": @{ @"name": @"type", @"description": @"Type text into an input element (appends)",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element ref ID" },
          @"text": @{ @"type": @"string", @"description": @"Text to type" } },
          @"required": @[ @"id", @"text" ] } } },
      @{ @"function": @{ @"name": @"fill", @"description": @"Clear input field and set new text",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element ref ID" },
          @"text": @{ @"type": @"string", @"description": @"Text to fill" } },
          @"required": @[ @"id", @"text" ] } } },
      @{ @"function": @{ @"name": @"select", @"description": @"Pick a dropdown option by value or visible text",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Select element ref ID" },
          @"value": @{ @"type": @"string", @"description": @"Option value or visible text" } },
          @"required": @[ @"id", @"value" ] } } },
      @{ @"function": @{ @"name": @"gettext", @"description": @"Read the text content of an element",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"id": @{ @"type": @"string", @"description": @"Element ref ID" } },
          @"required": @[ @"id" ] } } },
      @{ @"function": @{ @"name": @"scroll", @"description": @"Scroll the page",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"direction": @{ @"type": @"string", @"description": @"up, down, left, or right" },
          @"amount": @{ @"type": @"string", @"description": @"page, half, or small" } },
          @"required": @[ @"direction", @"amount" ] } } },
      @{ @"function": @{ @"name": @"go_back", @"description": @"Navigate back",
        @"parameters": @{ @"type": @"object", @"properties": @{} } } },
      @{ @"function": @{ @"name": @"wait", @"description": @"Wait for a condition: idle, url:<pattern>, selector:<css>, text:<substring>",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"condition": @{ @"type": @"string", @"description": @"idle, url:<pattern>, selector:<css>, or text:<substring>" } },
          @"required": @[ @"condition" ] } } },
      @{ @"function": @{ @"name": @"yield_to_user", @"description": @"Ask the user for help",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"reason": @{ @"type": @"string", @"description": @"Why user input is needed" } },
          @"required": @[ @"reason" ] } } },
      @{ @"function": @{ @"name": @"finish", @"description": @"Task is complete",
        @"parameters": @{ @"type": @"object", @"properties": @{
          @"status": @{ @"type": @"string", @"description": @"success or failure" },
          @"message": @{ @"type": @"string", @"description": @"Summary of outcome" } },
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
                   "Decide the single best next action to achieve the user's goal. "
                   "Respond with exactly one JSON object: {\"action\": \"<name>\", \"parameters\": {<params>}}. "
                   "Do not include any text outside the JSON."
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:systemMessage options:0 error:nil];
    systemMessageJSON = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  });

  // Build multimodal conversation message with screenshot file path + prompt.
  // LiteRT-LM's LoadItemData accepts {"type":"image","path":"..."} and
  // memory-maps the file directly — no base64 encoding needed.
  NSDictionary<NSString *, id> *message = @{
    @"role": @"user",
    @"content": @[
      @{ @"type": @"image", @"path": screenshotPath },
      @{ @"type": @"text", @"text": prompt },
    ],
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
      litert_lm_conversation_config_create(
          engine, sessionConfig,
          systemMessageJSON ? systemMessageJSON.UTF8String : nullptr,
          toolsJSON ? toolsJSON.UTF8String : nullptr,
          nullptr, false);
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
          parameters = cleaned;
        }
      }
    }
  }

  // Fallback: try {"action":"...", "parameters":{...}} format.
  if (action == nil) {
    action = responseDictionary[@"action"];
    parameters = responseDictionary[@"parameters"];

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
    LiteRTLMLogSmokeTestFailure(@"engine_load",
                                @"ensureEngineWithModelPath returned null.",
                                @{
                                  @"modelPath": modelPath ?: @"",
                                  @"runtimeConfig": LiteRTLMRuntimeConfigDiagnostics(runtimeConfig)
                                });
    return nil;
  }

  NSMutableDictionary<NSString *, id> *runtimeDiagnostics =
      [LiteRTLMRuntimeConfigDiagnostics(runtimeConfig) mutableCopy];
  runtimeDiagnostics[@"modelPath"] = modelPath ?: @"";
  runtimeDiagnostics[@"backend"] = _loadedBackend ?: @"unknown";
  runtimeDiagnostics[@"maxNumTokens"] = _loadedMaxNumTokens ?: @(0);
  runtimeDiagnostics[@"cacheMode"] = _loadedCacheMode ?: @"unknown";
  runtimeDiagnostics[@"cacheDirectory"] = _loadedCacheDirectory ?: @"";

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
      litert_lm_conversation_config_create(engine, sessionConfig, nullptr, nullptr, nullptr, false);

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
  InputData input = {};
  input.type = kInputText;
  input.data = trimmedPrompt.UTF8String;
  input.size = strlen(trimmedPrompt.UTF8String);

  LiteRtLmResponses *responses = litert_lm_session_generate_content(session, &input, 1);
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
