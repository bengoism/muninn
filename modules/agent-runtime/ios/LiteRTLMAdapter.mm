#import "LiteRTLMAdapter.h"

static NSString *const LiteRTLMAdapterErrorDomain = @"AgentRuntimeLiteRTLMAdapter";

@implementation LiteRTLMAdapter

- (NSDictionary<NSString *, id> *)runInferenceWithModelPath:(NSString *)modelPath
                                                     prompt:(NSString *)prompt
                                                       goal:(NSString *)goal
                                             screenshotPath:(NSString *)screenshotPath
                                                axNodeCount:(NSNumber *)axNodeCount
                                                      error:(NSError * _Nullable __autoreleasing *)error {
  if (error != nil) {
    *error = [NSError errorWithDomain:LiteRTLMAdapterErrorDomain
                                 code:501
                             userInfo:@{
                               NSLocalizedDescriptionKey:
                                 @"LiteRT-LM adapter boundary is compiled, but the upstream runtime is not linked yet.",
                               @"modelPath": modelPath ?: @"",
                               @"promptLength": @(prompt.length),
                               @"goalLength": @(goal.length),
                               @"screenshotPath": screenshotPath ?: @"",
                               @"axNodeCount": axNodeCount ?: @0,
                             }];
  }

  return nil;
}

@end
