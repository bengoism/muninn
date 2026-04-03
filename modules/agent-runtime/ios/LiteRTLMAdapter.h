#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface LiteRTLMAdapter : NSObject

- (nullable NSDictionary<NSString *, id> *)runInferenceWithModelPath:(NSString *)modelPath
                                                       runtimeConfig:(NSDictionary<NSString *, id> *)runtimeConfig
                                                              prompt:(NSString *)prompt
                                                                goal:(NSString *)goal
                                                      screenshotPath:(NSString *)screenshotPath
                                                         axNodeCount:(NSNumber *)axNodeCount
                                                               error:(NSError * _Nullable * _Nullable)error;

- (nullable NSDictionary<NSString *, id> *)runTextSmokeTestWithModelPath:(NSString *)modelPath
                                                           runtimeConfig:(NSDictionary<NSString *, id> *)runtimeConfig
                                                                  prompt:(NSString *)prompt
                                                                   error:(NSError * _Nullable * _Nullable)error;

@end

NS_ASSUME_NONNULL_END
