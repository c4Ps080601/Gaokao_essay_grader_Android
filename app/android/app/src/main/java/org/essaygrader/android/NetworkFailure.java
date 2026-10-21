package org.essaygrader.android;

import java.net.*;
import java.io.*;
import java.security.cert.CertificateException;
import javax.net.ssl.*;

/** Fixed messages only: exception text can contain URLs, headers or provider data. */
final class NetworkFailure {
    static String message(Throwable failure,String phase){
        for(Throwable e=failure; e!=null; e=e.getCause()){
            if(e instanceof SSLHandshakeException||e instanceof SSLPeerUnverifiedException||e instanceof CertificateException)
                return "安全连接校验失败：请开启自动日期时间；若仍失败，换网络排查代理、证书拦截或服务商证书问题。（证书握手）";
        }
        if(failure instanceof UnknownHostException)return "无法解析服务商域名：请核对接口地址，换用手机热点或切换 Wi-Fi/流量后再试。（域名解析）";
        if(failure instanceof SocketTimeoutException)return "模型连接或响应超时：请保持应用前台，切换网络后再手动重试。（"+phase+"超时）";
        if(failure instanceof ConnectException||failure instanceof NoRouteToHostException)
            return "无法建立服务商连接：请检查此应用的联网权限、当前网络、代理或 VPN。（建立连接）";
        if(failure instanceof SSLException)return "安全连接中断：请换网络再试；可能与网络拦截或服务商连接兼容性有关。（加密连接）";
        if(failure instanceof SocketException||failure instanceof EOFException)
            return "连接被中断：请保持应用前台，切换网络后再手动重试。（"+phase+"中断）";
        if(failure instanceof SecurityException)return "系统阻止了连接：请检查手机设置中此应用的联网限制。（系统限制）";
        if(failure instanceof URISyntaxException||failure instanceof IllegalArgumentException)
            return "接口地址无效：请在模型配置中填写不含账号、密码或附加参数的 HTTPS 地址。";
        return "网络请求未完成：请检查应用联网权限并换网络重试。（"+phase+"失败）";
    }
}
