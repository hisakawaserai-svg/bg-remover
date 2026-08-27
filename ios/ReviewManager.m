//
//  ReviewManager.m
//  BgRemover
//
//  ReviewManager.swift を React Native に登録するための橋渡し。
//  AppIconManager と同じく RCT_EXTERN_MODULE 方式なので bridging header は不要。
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ReviewManager, NSObject)

RCT_EXTERN_METHOD(requestReview:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
