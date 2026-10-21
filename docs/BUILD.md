# 构建说明

Windows：Node.js 22.12+、npm、JDK 21、Android SDK 36。仓库根目录先执行 `python scripts/setup-android.py`，在 app 中 `npm ci`。`npm run android:build` 生成调试 APK；根目录 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Release` 构建 release 并使用你自己本机的发布密钥签名。

工具安装脚本将官方工具下载到被忽略的 `.android-tools/`。非 Windows 平台可自行配置 JDK/SDK，先运行 `npm run android:sync`，再在 `app/android` 使用 Gradle Wrapper 构建。

`npm run generate:mobile-core` 从共用 grader/providers/rubric 等生成 Android 所需模块，随 `build:ui` 和 `npm test` 自动运行；不应手改 generated 目录。构建后的 Web 资源由 Capacitor 同步，未把本机生成物提交源码。

发布密钥生成于 `.android-tools/release-signing/`，DPAPI 密码与生成它的 Windows 账户绑定；迁移设备前需在原账户下安全导出并备份，单独复制 DPAPI 文件不保证可在新设备解密。此目录不得提交或公开。官方已有私钥未随源码分发，自行构建签名不同，不能覆盖官方 APK。

测试：`npm run check:ui`、`npm test`；`npm run test:ui` 需先安装 Electron（`npm run setup:electron`），并运行在具备图形依赖的环境。Android 桥模拟集成测试：`node test/android-media-ui.cjs`，同样使用 Electron。测试用凭据均为合成示例，不是真实账户；测试产物不得提交。真机相机、文件提供者与后台行为需另行验收。
