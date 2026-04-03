#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface LiteRTLMAdapter : NSObject

- (nullable NSDictionary<NSString *, id> *)runInferenceWithModelPath:(NSString *)modelPath
                                                              prompt:(NSString *)prompt
                                                                goal:(NSString *)goal
                                                      screenshotPath:(NSString *)screenshotPath
                                                         axNodeCount:(NSNumber *)axNodeCount
                                                               error:(NSError * _Nullable * _Nullable)error;

@end

NS_ASSUME_NONNULL_END
