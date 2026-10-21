package org.essaygrader.android;

import android.content.Intent;
import android.content.ClipData;
import android.app.Activity;
import android.provider.MediaStore;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.os.Bundle;
import android.Manifest;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import androidx.core.content.FileProvider;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name="EssayNative", permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class EssayNativePlugin extends Plugin {
    private final ExecutorService workers = Executors.newFixedThreadPool(3);
    private final Object storageLock = new Object();
    private static final String ALIAS = "essaygrader.api.v1";
    private boolean cameraOpen=false, documentOpen=false;
    @PluginMethod public void startTask(PluginCall call){
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"taskPermissionResult");return;}
        launchTask(call);
    }
    @PermissionCallback private void taskPermissionResult(PluginCall call){launchTask(call);}
    private void launchTask(PluginCall call){
        getActivity().runOnUiThread(()->{try{
            String token=required(call,"token");if(!token.matches("[a-zA-Z0-9_-]{1,100}"))throw new IllegalArgumentException();
            Handler main=new Handler(Looper.getMainLooper());
            Runnable timeout=()->call.reject("无法确认后台任务已启动，请保持前台后重试；尚未发送模型请求");
            main.postDelayed(timeout,4500);
            ResultReceiver reply=new ResultReceiver(main){@Override protected void onReceiveResult(int code,Bundle data){main.removeCallbacks(timeout);if(code==1)call.resolve();else call.reject("系统未允许启动后台批改，请检查后台运行限制；尚未发送模型请求");}};
            Intent intent=new Intent(getContext(),GradingService.class).setAction("start").putExtra("token",token).putExtra("reply",reply);
            try{if(Build.VERSION.SDK_INT>=26)getContext().startForegroundService(intent);else getContext().startService(intent);}
            catch(Exception e){main.removeCallbacks(timeout);throw e;}
        }catch(Exception e){call.reject("后台任务启动失败，请检查系统后台限制；尚未发送模型请求");}});
    }
    @PluginMethod public void endTask(PluginCall call){
        try{getContext().startService(new Intent(getContext(),GradingService.class).setAction("end").putExtra("token",required(call,"token")));call.resolve();}
        catch(Exception e){call.reject("后台任务结束确认失败");}
    }
    @PluginMethod public void minimizeApp(PluginCall call){getActivity().runOnUiThread(()->{getActivity().moveTaskToBack(true);call.resolve();});}
    private AtomicFile stateFile() { return new AtomicFile(new File(getContext().getFilesDir(), "essay-state-v1.json")); }
    private String required(PluginCall call, String name) {
        String value=call.getString(name);
        if(value==null)throw new IllegalArgumentException("缺少参数："+name);
        return value;
    }
    private synchronized SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry)store.getEntry(ALIAS,null)).getSecretKey();
    }
    @PluginMethod public void readState(PluginCall call) {
        workers.execute(()->{synchronized(storageLock){try {
            AtomicFile file=stateFile(); JSObject result=new JSObject();
            if(!file.getBaseFile().exists()&&!new File(file.getBaseFile()+".bak").exists())result.put("value",org.json.JSONObject.NULL);
            else result.put("value",new String(file.readFully(),StandardCharsets.UTF_8));
            call.resolve(result);
        }catch(Exception e){call.reject("无法读取本机数据；请勿清理应用数据",e);}}});
    }
    @PluginMethod public void writeState(PluginCall call) {
        workers.execute(()->{synchronized(storageLock){AtomicFile file=stateFile();FileOutputStream output=null;
            try {
                String value=required(call,"value");if(value.length()>32*1024*1024)throw new IOException("数据超过32MB上限，请先备份整理");
                new org.json.JSONObject(value);
                output=file.startWrite();output.write(value.getBytes(StandardCharsets.UTF_8));file.finishWrite(output);call.resolve();
            }catch(Exception e){if(output!=null)file.failWrite(output);call.reject("本机保存失败，请检查可用空间；当前内容未确认保存",e);}
        }});
    }
    @PluginMethod public void seal(PluginCall call) {
        workers.execute(()->{try {
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
            byte[] encrypted=cipher.doFinal(required(call,"value").getBytes(StandardCharsets.UTF_8));
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();bytes.write(cipher.getIV());bytes.write(encrypted);
            JSObject result=new JSObject();result.put("value",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP));call.resolve(result);
        }catch(Exception e){call.reject("系统密钥加密失败，未保存明文密钥",e);}});
    }
    @PluginMethod public void unseal(PluginCall call) {
        workers.execute(()->{try {
            byte[] bytes=Base64.decode(required(call,"value"),Base64.NO_WRAP);
            if(bytes.length<29)throw new IOException("无效密文");
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOfRange(bytes,0,12)));
            JSObject result=new JSObject();result.put("value",new String(cipher.doFinal(Arrays.copyOfRange(bytes,12,bytes.length)),StandardCharsets.UTF_8));call.resolve(result);
        }catch(Exception e){call.reject("系统无法解密原密钥，请重新填写自己的API Key",e);}});
    }
    @PluginMethod public void http(PluginCall call) {
        workers.execute(()->{HttpURLConnection connection=null;String phase="建立连接";try {
            URI uri=new URI(required(call,"url"));
            if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getUserInfo()!=null||uri.getHost()==null||uri.getFragment()!=null||uri.getQuery()!=null)throw new IllegalArgumentException();
            connection=(HttpURLConnection)uri.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setDoOutput(true);
            int timeout=Math.max(1000,Math.min(240000,call.getInt("timeout",180000)));
            connection.setConnectTimeout(30000);connection.setReadTimeout(timeout);
            JSObject headers=call.getObject("headers",new JSObject());Iterator<String> keys=headers.keys();
            while(keys.hasNext()){String name=keys.next();connection.setRequestProperty(name,headers.getString(name));}
            byte[] body=required(call,"body").getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(body.length);
            try(OutputStream stream=connection.getOutputStream()){phase="发送请求";stream.write(body);}
            phase="等待响应";
            int status=connection.getResponseCode();String data="";
            // Never forward authentication headers to a redirect destination or expose provider error bodies.
            if(status>=200&&status<300){try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int n;
                while((n=input.read(buffer))!=-1){if(output.size()+n>32*1024*1024)throw new IOException("模型返回内容过大");output.write(buffer,0,n);}
                data=output.toString("UTF-8");
            }}
            JSObject result=new JSObject();result.put("status",status);result.put("data",data);call.resolve(result);
        }catch(Exception e){call.reject(NetworkFailure.message(e,phase));}
        finally{if(connection!=null)connection.disconnect();}});
    }
    @PluginMethod public void checkNetwork(PluginCall call){
        workers.execute(()->{HttpURLConnection connection=null;try{
            URI input=new URI(required(call,"url"));
            if(!"https".equalsIgnoreCase(input.getScheme())||input.getHost()==null||input.getUserInfo()!=null||input.getQuery()!=null||input.getFragment()!=null)throw new IllegalArgumentException();
            URI origin=new URI("https",null,input.getHost(),input.getPort(),"/",null,null);
            connection=(HttpURLConnection)origin.toURL().openConnection();
            connection.setRequestMethod("HEAD");connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
            connection.setConnectTimeout(15000);connection.setReadTimeout(15000);
            int status=connection.getResponseCode();if(status<100)throw new IOException();
            JSObject result=new JSObject();result.put("message","已收到服务商源站的 HTTP "+status+" 响应，网络已连通。未发送 Key 或作文；这不代表密钥、模型或批改接口可用。");call.resolve(result);
        }catch(Exception e){call.reject(NetworkFailure.message(e,"网络检查"));}
        finally{if(connection!=null)connection.disconnect();}});
    }
    private File cacheDir(String name) throws IOException {
        File dir=new File(getContext().getCacheDir(),name);
        if(!dir.exists()&&!dir.mkdirs())throw new IOException("无法创建临时目录");
        File[] stale=dir.listFiles();
        if(stale!=null)for(File f:stale)if(f.isFile()&&System.currentTimeMillis()-f.lastModified()>48L*3600000)f.delete();
        return dir;
    }
    private File storedFile(PluginCall call,String folder,String field) throws IOException {
        String name=required(call,field);
        if(!name.matches("[a-zA-Z0-9._-]+")||name.equals(".")||name.equals(".."))throw new IOException("无效临时文件");
        File file=new File(cacheDir(folder),name);
        if(!file.isFile())throw new IOException("临时文件已失效，请重试");
        return file;
    }
    @PluginMethod public void capturePhoto(PluginCall call) {
        getActivity().runOnUiThread(()->{
            if(cameraOpen||documentOpen){call.reject("请先完成上一次拍照或文件保存");return;}
            File file=null;
            try {
                file=File.createTempFile("capture-",".jpg",cacheDir("camera"));
                Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
                call.getData().put("captureName",file.getName());
                Intent intent=new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri("photo",uri));
                cameraOpen=true;startActivityForResult(call,intent,"photoResult");
            } catch(Exception e){cameraOpen=false;if(file!=null)file.delete();call.reject("无法打开系统相机，请检查相机应用及权限，或从相册选择照片");}
        });
    }
    @ActivityCallback private void photoResult(PluginCall call,ActivityResult activityResult) {
        cameraOpen=false;if(call==null)return;
        workers.execute(()->{
            File file=null;Uri uri=null;
            try {
                file=storedFile(call,"camera","captureName");
                uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
                JSObject result=new JSObject();result.put("token",call.getString("token",""));
                boolean canceled=activityResult.getResultCode()!=Activity.RESULT_OK;result.put("canceled",canceled);
                if(!canceled)result.put("data",CaptureImage.read(file));
                call.resolve(result);
            }catch(Exception e){call.reject("无法读取拍摄照片，请重新拍摄或从相册选择");}
            finally{try{if(uri!=null)getContext().revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(SecurityException ignored){}finally{if(file!=null)file.delete();}}
        });
    }
    private String mime(PluginCall call) throws IOException {
        String mime=required(call,"mime");
        if(!Arrays.asList("application/json","image/png","application/pdf").contains(mime))throw new IOException("文件类型无效");
        return mime;
    }
    private String exportName(PluginCall call,String mime){
        String name=call.getString("name","作文批改报告").replaceAll("[^\\p{L}\\p{N}._-]","_");
        if(name.length()>90)name=name.substring(0,90);
        String suffix=mime.equals("application/pdf")?".pdf":mime.equals("image/png")?".png":".json";
        if(!name.endsWith(suffix))name+=suffix;
        return name;
    }
    private File dataFile(PluginCall call) throws Exception {
        String data=required(call,"data");if(data.length()>48*1024*1024)throw new IOException("导出文件超过36MB上限");
        byte[] bytes=Base64.decode(data,Base64.DEFAULT);if(bytes.length==0)throw new IOException("导出文件为空");
        File file=File.createTempFile("export-",".tmp",cacheDir("exports"));
        try(FileOutputStream stream=new FileOutputStream(file)){stream.write(bytes);}catch(Exception e){file.delete();throw e;}
        return file;
    }
    private void deliver(PluginCall call,File file,String mime,boolean share) {
        getActivity().runOnUiThread(()->{try{
            // Saved activity-result state must not include megabytes of image/report data.
            call.getData().remove("data");call.getData().remove("report");
            if(share){
                Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file,exportName(call,mime));
                Intent intent=new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri("export",uri));
                getActivity().startActivity(Intent.createChooser(intent,"分享批改文件"));call.resolve();
            }else{
                if(documentOpen||cameraOpen){file.delete();call.reject("请先完成上一次拍照或文件保存");return;}
                call.getData().put("exportFile",file.getName());
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime)
                    .putExtra(Intent.EXTRA_TITLE,exportName(call,mime));
                documentOpen=true;startActivityForResult(call,intent,"saveResult");
            }
        }catch(Exception e){if(!share)documentOpen=false;file.delete();call.reject("无法打开文件保存或分享界面，请重试");}});
    }
    @PluginMethod public void shareFile(PluginCall call){exportData(call,true);}
    @PluginMethod public void saveFile(PluginCall call){exportData(call,false);}
    private void exportData(PluginCall call,boolean share){
        workers.execute(()->{try{String type=mime(call);deliver(call,dataFile(call),type,share);}
            catch(Exception e){call.reject("无法导出文件，请检查文件大小及可用空间");}});
    }
    @PluginMethod public void exportPdf(PluginCall call){
        workers.execute(()->{
            File file=null;
            try{
                file=File.createTempFile("report-",".pdf",cacheDir("exports"));
                PdfReportWriter.write(call.getObject("report"),file);
                deliver(call,file,"application/pdf",Boolean.TRUE.equals(call.getBoolean("share",false)));
            }catch(Exception e){if(file!=null)file.delete();call.reject("PDF生成失败，请检查报告长度及可用空间");}
        });
    }
    @ActivityCallback private void saveResult(PluginCall call,ActivityResult activityResult){
        documentOpen=false;if(call==null)return;
        workers.execute(()->{
            File file=null;
            try{
                file=storedFile(call,"exports","exportFile");
                Uri uri=activityResult.getData()==null?null:activityResult.getData().getData();
                boolean canceled=activityResult.getResultCode()!=Activity.RESULT_OK||uri==null;
                if(!canceled)try(InputStream input=new FileInputStream(file);OutputStream output=getContext().getContentResolver().openOutputStream(uri,"w")){
                    if(output==null)throw new IOException("无法写入目标文件");
                    byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);output.flush();
                }
                JSObject result=new JSObject();result.put("canceled",canceled);call.resolve(result);
            }catch(Exception e){call.reject("文件保存失败，请检查所选位置和可用空间");}
            finally{if(file!=null)file.delete();}
        });
    }
    @Override protected void handleOnDestroy(){workers.shutdown();super.handleOnDestroy();}
}
