package org.essaygrader.android;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.util.Base64;
import java.io.*;

/** Samples before decoding, normalizes all EXIF orientations, emits no source metadata. */
final class CaptureImage {
    static String read(File file) throws IOException {
        if (!file.isFile() || file.length()==0 || file.length()>64*1024*1024) throw new IOException("相机没有返回有效照片");
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        BitmapFactory.decodeFile(file.getPath(),options);
        if(options.outWidth<1||options.outHeight<1)throw new IOException("无法读取照片");
        options.inSampleSize=1;
        while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>3200)options.inSampleSize*=2;
        options.inJustDecodeBounds=false;
        Bitmap bitmap=BitmapFactory.decodeFile(file.getPath(),options);
        if(bitmap==null)throw new IOException("无法解码照片");
        try {
            float scale=Math.min(1f,1600f/Math.max(bitmap.getWidth(),bitmap.getHeight()));
            if(scale<1){Bitmap smaller=Bitmap.createScaledBitmap(bitmap,Math.max(1,Math.round(bitmap.getWidth()*scale)),Math.max(1,Math.round(bitmap.getHeight()*scale)),true);bitmap.recycle();bitmap=smaller;}
            int orientation=new ExifInterface(file.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);
            Matrix matrix=new Matrix();
            switch(orientation){
                case 2:matrix.setScale(-1,1);break;
                case 3:matrix.setRotate(180);break;
                case 4:matrix.setRotate(180);matrix.postScale(-1,1);break;
                case 5:matrix.setRotate(90);matrix.postScale(-1,1);break;
                case 6:matrix.setRotate(90);break;
                case 7:matrix.setRotate(-90);matrix.postScale(-1,1);break;
                case 8:matrix.setRotate(-90);break;
            }
            Bitmap upright=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),matrix,true);
            if(upright!=bitmap){bitmap.recycle();bitmap=upright;}
            try(ByteArrayOutputStream out=new ByteArrayOutputStream()){
                if(!bitmap.compress(Bitmap.CompressFormat.JPEG,88,out))throw new IOException("照片处理失败");
                return Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);
            }
        } finally {bitmap.recycle();}
    }
}
