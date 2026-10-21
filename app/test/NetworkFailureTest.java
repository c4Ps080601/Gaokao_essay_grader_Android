package org.essaygrader.android;
import java.net.*;
import java.io.*;
import javax.net.ssl.*;
public final class NetworkFailureTest {
    public static void main(String[] args){
        Throwable[] errors={new UnknownHostException("private-url-and-key"),new SocketTimeoutException("private-url-and-key"),new SSLHandshakeException("private-url-and-key"),new ConnectException("private-url-and-key"),new SocketException("private-url-and-key"),new SecurityException("private-url-and-key"),new IllegalArgumentException("private-url-and-key"),new IOException("private-url-and-key")};
        String[] expected={"域名解析","超时","证书握手","建立连接","中断","系统限制","接口地址无效","失败"};
        for(int i=0;i<errors.length;i++){
            String message=NetworkFailure.message(errors[i],"等待响应");
            if(!message.contains(expected[i])||message.contains("private-url-and-key"))throw new AssertionError(i);
        }
        if(!NetworkFailure.message(new IOException(new java.security.cert.CertificateException("secret")),"建立连接").contains("证书握手"))throw new AssertionError("nested certificate");
        System.out.println("PASS: 9 network error categories/cause cases, no exception text disclosed");
    }
}
