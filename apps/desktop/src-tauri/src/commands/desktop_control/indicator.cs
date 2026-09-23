using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class JackalopeWindowIndicator : Form {
    const ulong InputTag=0x4A41434B;
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct NativePoint { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public NativePoint Point; public uint Data,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint Key,Scan,Flags,Time; public UIntPtr Extra; }
    delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id,Hook callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr handle,out Rect rect);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle,out uint process);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    sealed class Glow : Form {
        [StructLayout(LayoutKind.Sequential)] struct SizeNative { public int Width,Height; }
        [StructLayout(LayoutKind.Sequential,Pack=1)] struct Blend { public byte Op,Flags,Alpha,Format; }
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window,IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
        [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr window,IntPtr dstDc,ref NativePoint position,ref SizeNative size,IntPtr srcDc,ref NativePoint source,uint key,ref Blend blend,uint flags);
        Rectangle previous;
        Color previousColor;
        
        public Glow() { FormBorderStyle=FormBorderStyle.None; ShowInTaskbar=false; TopMost=true; }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams { get { var value=base.CreateParams; value.ExStyle|=0x08000000|0x80000|0x80|0x20; return value; } }
        public void Render(Rectangle area,Color accent) {
            if(area==previous && accent==previousColor) return;
            previous=area; previousColor=accent;
            using(var bitmap=DrawOverlay(area.Size,accent)) {
                var screen=GetDC(IntPtr.Zero); var memory=CreateCompatibleDC(screen);
                var image=bitmap.GetHbitmap(Color.FromArgb(0)); var old=SelectObject(memory,image);
                try {
                    var position=new NativePoint{X=area.Left,Y=area.Top}; var size=new SizeNative{Width=area.Width,Height=area.Height}; var origin=new NativePoint();
                    var blend=new Blend{Alpha=255,Format=1};
                    if(!UpdateLayeredWindow(Handle,screen,ref position,ref size,memory,ref origin,0,ref blend,2)) throw new Exception("Desktop overlay could not be drawn.");
                } finally { SelectObject(memory,old); DeleteObject(image); DeleteDC(memory); ReleaseDC(IntPtr.Zero,screen); }
            }
        }
    }
    readonly IntPtr target;
    readonly int processId;
    readonly long processStarted;
    readonly string stateFile,themeFile;
    readonly Glow glow=new Glow();
    readonly Image logoImage;
    readonly Label heading=new Label();
    readonly Label hint=new Label();
    readonly PictureBox mark=new PictureBox();
    readonly Button toggle=new Button(), stop=new Button();
    readonly Timer timer=new Timer();
    readonly System.Threading.EventWaitHandle gate;
    readonly Hook keyboard,mouse;
    IntPtr keyboardHook,mouseHook;
    string state="starting",reason="";
    long epoch=1;
    Rect prior;
    NativePoint pointer;
    bool disposed;

    protected override bool ShowWithoutActivation { get { return true; } }
    public JackalopeWindowIndicator(long handle,int pid,long started,string file,string theme,string logo) {
        target=new IntPtr(handle); processId=pid; processStarted=started; stateFile=file; themeFile=theme;
        gate=new System.Threading.EventWaitHandle(false,System.Threading.EventResetMode.ManualReset,"Local\\JackalopeDesktop-"+Path.GetFileName(Path.GetDirectoryName(file)));
        gate.Reset();
        Text="Jackalope desktop control"; AccessibleName=Text; FormBorderStyle=FormBorderStyle.None;
        ControlBox=false; ShowInTaskbar=false; TopMost=true; AutoScaleMode=AutoScaleMode.None;
        ClientSize=new Size(1,1); BackColor=Color.Black; ForeColor=Color.White;
        logoImage=Image.FromFile(logo);
        mark.SizeMode=PictureBoxSizeMode.Zoom; mark.Image=logoImage; mark.AccessibleName="Jackalope";
        heading.ForeColor=Color.White; hint.ForeColor=Color.FromArgb(185,185,195);
        toggle.AccessibleName="Pause desktop control";
        stop.Text="Cancel"; stop.AccessibleName="Cancel desktop control";
        foreach(var button in new[]{toggle,stop}) { button.Font=new Font("Segoe UI",14,FontStyle.Regular,GraphicsUnit.Pixel); button.BackColor=BackColor; button.ForeColor=Color.White; button.FlatStyle=FlatStyle.Flat; button.FlatAppearance.BorderSize=0; button.FlatAppearance.MouseOverBackColor=Color.FromArgb(55,55,65); }
        toggle.Click+=(sender,args)=>{ if(state=="active") Pause("Paused by you"); else Resume(); };
        stop.Click+=(sender,args)=>Cancel();
        Controls.AddRange(new Control[]{mark,heading,hint,toggle,stop});
        keyboard=OnKey; mouse=OnMouse;
        Shown+=(sender,args)=>{
            keyboardHook=SetWindowsHookEx(13,keyboard,GetModuleHandle(null),0);
            mouseHook=SetWindowsHookEx(14,mouse,GetModuleHandle(null),0);
            if(keyboardHook==IntPtr.Zero || mouseHook==IntPtr.Zero) { Console.Error.WriteLine("Input monitor failed: "+Marshal.GetLastWin32Error()); Cancel(); return; }
            Resume(); timer.Start();
        };
        timer.Interval=100; timer.Tick+=(sender,args)=>Pulse();
        FormClosing+=(sender,args)=>{ gate.Reset(); state="canceled"; epoch++; WriteState(); Cleanup(); };
    }
    bool TargetValid() {
        uint pid;
        if(!IsWindow(target)) return false;
        GetWindowThreadProcessId(target,out pid);
        if(pid!=processId) return false;
        try { using(var process=Process.GetProcessById(processId)) return process.StartTime.ToUniversalTime().Ticks==processStarted; } catch { return false; }
    }
    void Resume() {
        if(!TargetValid()) { Console.Error.WriteLine("Selected window identity changed before resuming."); Cancel(); return; }
        if(IsIconic(target) || !IsWindowVisible(target)) { Pause("Restore the selected window"); return; }
        SetForegroundWindow(target);
        if(GetForegroundWindow()!=target) { Pause("Focus the window, then resume"); return; }
        gate.Reset(); GetWindowRect(target,out prior); GetCursorPos(out pointer); state="active"; reason=""; epoch++; UpdateLabels();
        if(WriteState() && state=="active") gate.Set(); Pulse();
    }
    void Pause(string why) {
        if(state=="canceled") return;
        gate.Reset();
        if(state!="paused") { state="paused"; epoch++; }
        reason=why; Console.Error.WriteLine("Desktop control paused: "+why); UpdateLabels(); WriteState();
    }
    void Cancel() { gate.Reset(); state="canceled"; epoch++; WriteState(); Close(); }
    void UpdateLabels() {
        bool active=state=="active";
        heading.Text=active ? "Jackalope is using your computer" : "Jackalope is Paused";
        hint.Text=active ? "Esc to cancel   ·   Mouse or keyboard activity pauses control" : "Click Resume to continue   ·   Esc to cancel";
        toggle.Text=active ? "Pause" : "Resume";
        toggle.AccessibleName=toggle.Text+" desktop control";
        LayoutBar();
        heading.AccessibleDescription=reason;
    }
    void LayoutBar() {
        var screen=Screen.FromHandle(target).Bounds;
        float scale=0.9f*Math.Min(Math.Max(1,GetDpiForWindow(Handle)/96f),(screen.Width-24)/850f);
        int width=(int)(850*scale), height=(int)(100*scale);
        if(ClientSize.Width!=width || ClientSize.Height!=height) {
            ClientSize=new Size(width,height);
            mark.SetBounds((int)(24*scale),(int)(26*scale),(int)(48*scale),(int)(48*scale));
            heading.SetBounds((int)(90*scale),(int)(20*scale),(int)(566*scale),(int)(34*scale));
            hint.SetBounds((int)(90*scale),(int)(57*scale),(int)(566*scale),(int)(24*scale));
            toggle.SetBounds((int)(674*scale),(int)(28*scale),(int)(80*scale),(int)(44*scale));
            stop.SetBounds((int)(754*scale),(int)(28*scale),(int)(76*scale),(int)(44*scale));
            SetFont(heading,24*scale,FontStyle.Bold); SetFont(hint,17*scale,FontStyle.Regular);
            SetFont(toggle,16*scale,FontStyle.Regular); SetFont(stop,16*scale,FontStyle.Regular);
            int radius=(int)(24*scale);
            using(var shape=new GraphicsPath()) {
                shape.AddLine(0,0,width,0); shape.AddLine(width,0,width,height-radius);
                shape.AddArc(width-radius*2,height-radius*2,radius*2,radius*2,0,90);
                shape.AddArc(0,height-radius*2,radius*2,radius*2,90,90); shape.CloseFigure();
                var previous=Region; Region=new Region(shape); if(previous!=null)previous.Dispose();
            }
        }
        Location=new Point(screen.Left+(screen.Width-Width)/2,screen.Top);
    }
    static void SetFont(Control control,float size,FontStyle style) {
        if(Math.Abs(control.Font.Size-size)<0.01f && control.Font.Style==style && control.Font.Unit==GraphicsUnit.Pixel) return;
        var previous=control.Font; control.Font=new Font("Segoe UI",size,style,GraphicsUnit.Pixel); if(!previous.Equals(Control.DefaultFont)) previous.Dispose();
    }
    IntPtr OnKey(int code,IntPtr message,IntPtr data) {
        if(code>=0) {
            var key=(KeyData)Marshal.PtrToStructure(data,typeof(KeyData));
            bool ours=(key.Flags&0x10)!=0 && key.Extra.ToUInt64()==InputTag;
            if(!ours) {
                if(key.Key==27 && ((int)message==0x100 || (int)message==0x104)) { Cancel(); return new IntPtr(1); }
                if(((int)message==0x100 || (int)message==0x104) && GetForegroundWindow()!=Handle && state=="active") Pause("Keyboard activity detected");
            }
        }
        return CallNextHookEx(keyboardHook,code,message,data);
    }
    IntPtr OnMouse(int code,IntPtr message,IntPtr data) {
        if(code>=0 && state=="active") {
            var input=(MouseData)Marshal.PtrToStructure(data,typeof(MouseData));
            bool ours=(input.Flags&1)!=0 && input.Extra.ToUInt64()==InputTag;
            if(ours) pointer=input.Point;
            bool moved=Math.Abs(input.Point.X-pointer.X)>2 || Math.Abs(input.Point.Y-pointer.Y)>2;
            if(!ours && ((int)message!=0x200 || moved) && !(Visible && Bounds.Contains(input.Point.X,input.Point.Y))) Pause("Mouse activity detected");
        }
        return CallNextHookEx(mouseHook,code,message,data);
    }
    void Pulse() {
        if(disposed || state=="canceled") return;
        if(!TargetValid()) { Cancel(); return; }
        Rect rect; if(!GetWindowRect(target,out rect)) { Cancel(); return; }
        bool visible=IsWindowVisible(target) && !IsIconic(target);
        if(state=="active" && (!visible || GetForegroundWindow()!=target)) Pause("Window is no longer active");
        if(state=="active" && (rect.Left!=prior.Left || rect.Top!=prior.Top || rect.Right!=prior.Right || rect.Bottom!=prior.Bottom)) Pause("Window moved or resized");
        prior=rect;
        var screen=Screen.FromHandle(target).Bounds;
        LayoutBar();
        Color accent=Color.FromArgb(99,102,241);
        try { string hex=File.ReadAllText(themeFile).Trim(); if(System.Text.RegularExpressions.Regex.IsMatch(hex,"^#[0-9a-fA-F]{6}$")) accent=ColorTranslator.FromHtml(hex); } catch { }
        glow.Show(); glow.Render(screen,accent);
        SetWindowPos(Handle,new IntPtr(-1),0,0,0,0,0x13);
        WriteState();
    }
    bool WriteState() {
        try {
            string value;
            using(var process=Process.GetCurrentProcess()) value=state+"|"+epoch+"|"+DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+"|"+process.Id+"|"+process.StartTime.ToUniversalTime().Ticks+"|"+reason;
            string temporary=stateFile+".tmp"; File.WriteAllText(temporary,value);
            if(File.Exists(stateFile)) File.Replace(temporary,stateFile,null); else File.Move(temporary,stateFile);
            return true;
        } catch(Exception error) { gate.Reset(); Console.Error.WriteLine("Indicator state could not be saved: "+error.Message); if(state!="canceled") { state="canceled"; Close(); } return false; }
    }
    void Cleanup() {
        if(disposed) return; disposed=true; timer.Stop();
        gate.Reset();
        if(keyboardHook!=IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
        if(mouseHook!=IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        glow.Dispose();
        logoImage.Dispose();
        gate.Dispose();
    }
    public static void Run(long handle,int pid,string started,string file,string theme,string logo) {
        SetProcessDpiAwarenessContext(new IntPtr(-4)); SetThreadDpiAwarenessContext(new IntPtr(-4));
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        Application.EnableVisualStyles();
        using(var form=new JackalopeWindowIndicator(handle,pid,long.Parse(started),file,theme,logo)) {
            try { Application.Run(form); } finally { form.Cleanup(); }
        }
    }

    public static Bitmap DrawOverlay(Size size,Color accent) {
        var bitmap=new Bitmap(size.Width,size.Height,PixelFormat.Format32bppArgb);
        var data=bitmap.LockBits(new Rectangle(Point.Empty,size),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
        try {
            var pixels=new byte[data.Stride*size.Height];
            int depth=Math.Min(96,Math.Min(size.Width,size.Height)/4);
            var alpha=new byte[depth];
            for(int i=0;i<depth;i++) alpha[i]=(byte)(210*Math.Pow(1-i/(double)depth,2));
            for(int y=0;y<size.Height;y++) for(int x=0;x<size.Width;x++) {
                int inset=Math.Min(Math.Min(x,size.Width-1-x),Math.Min(y,size.Height-1-y));
                if(inset>=depth) continue;
                int offset=y*data.Stride+x*4;
                pixels[offset]=accent.B; pixels[offset+1]=accent.G; pixels[offset+2]=accent.R; pixels[offset+3]=alpha[inset];
            }
            Marshal.Copy(pixels,0,data.Scan0,pixels.Length);
        } finally { bitmap.UnlockBits(data); }
        return bitmap;
    }
}
