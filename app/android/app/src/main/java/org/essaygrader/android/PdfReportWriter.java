package org.essaygrader.android;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;

/** A4 text PDF: system font fallback supplies Chinese glyphs; no screenshots or HTML. */
final class PdfReportWriter implements AutoCloseable {
    private final PdfDocument doc=new PdfDocument();
    private PdfDocument.Page page;
    private Canvas canvas;
    private int number=0;
    private float y;
    private static final int WIDTH=523, BOTTOM=792;
    private void newPage() throws IOException {
        finishPage();
        if(number>=500)throw new IOException("报告超过500页，请先导出作文备份");
        page=doc.startPage(new PdfDocument.PageInfo.Builder(595,842,++number).create());canvas=page.getCanvas();y=65;
        Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setTextSize(10);p.setColor(Color.rgb(117,82,61));
        canvas.drawText("续写批改站 · 批改报告",36,34,p);
        p.setColor(Color.rgb(225,217,210));canvas.drawLine(36,44,559,44,p);
    }
    private void finishPage(){
        if(page==null)return;
        Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setTextSize(9);p.setColor(Color.GRAY);
        canvas.drawText(String.valueOf(number),290,820,p);doc.finishPage(page);page=null;
    }
    private void text(String text,float size,boolean heading) throws IOException {
        if(text.isEmpty())return;
        TextPaint p=new TextPaint(Paint.ANTI_ALIAS_FLAG);p.setTextSize(size);p.setColor(Color.rgb(45,44,41));
        p.setTypeface(heading?Typeface.create("sans-serif",Typeface.BOLD):Typeface.create("sans-serif",Typeface.NORMAL));
        StaticLayout layout=StaticLayout.Builder.obtain(text,0,text.length(),p,WIDTH).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(true).setLineSpacing(3,1).build();
        int start=0;
        while(start<layout.getLineCount()){
            if(page==null||y+layout.getLineBottom(start)-layout.getLineTop(start)>BOTTOM)newPage();
            int end=start+1;int top=layout.getLineTop(start);
            while(end<layout.getLineCount()&&y+layout.getLineBottom(end)-top<=BOTTOM)end++;
            float height=layout.getLineBottom(end-1)-top;
            canvas.save();canvas.clipRect(36,y,559,y+height);canvas.translate(36,y-top);layout.draw(canvas);canvas.restore();
            y+=height;start=end;
            if(start<layout.getLineCount())newPage();
        }
        y+=heading?8:16;
    }
    static void write(JSONObject report,File output) throws Exception {
        String title=report.getString("title");JSONArray sections=report.getJSONArray("sections");
        if(title.length()>200000||sections.length()>60)throw new IOException("报告格式或长度无效");
        int length=title.length();
        for(int i=0;i<sections.length();i++){JSONObject s=sections.getJSONObject(i);length+=s.getString("title").length()+s.getString("text").length();}
        if(length>1000000)throw new IOException("报告超过导出长度上限，请先导出作文备份");
        try(PdfReportWriter writer=new PdfReportWriter()){
            writer.newPage();writer.text(title,21,true);
            for(int i=0;i<sections.length();i++){
                JSONObject s=sections.getJSONObject(i);
                if(writer.y>BOTTOM-75)writer.newPage();
                writer.text(s.getString("title"),14,true);writer.text(s.getString("text"),11.5f,false);
            }
            writer.finishPage();
            try(FileOutputStream stream=new FileOutputStream(output)){writer.doc.writeTo(stream);}
        }
    }
    @Override public void close(){finishPage();doc.close();}
}
