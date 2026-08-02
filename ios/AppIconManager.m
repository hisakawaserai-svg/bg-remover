//
//  AppIconManager.m
//  BgRemover
//
//  Created by h S. on 2026/08/01.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AppIconManager, NSObject)

RCT_EXTERN_METHOD(changeIcon:(NSString *)iconName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
