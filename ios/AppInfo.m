//
//  AppInfo.m
//  BgRemover
//
//  AppInfo.swift を React Native に登録するための橋渡し。
//  ReviewManager と同じく RCT_EXTERN_MODULE 方式なので bridging header は不要。
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AppInfo, NSObject)

@end
