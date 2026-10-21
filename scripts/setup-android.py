"""Workspace-local official toolchain; no machine-wide PATH changes."""
from pathlib import Path
import urllib.request, json, hashlib, zipfile, concurrent.futures

root = Path(__file__).resolve().parents[1] / '.android-tools'
root.mkdir(exist_ok=True)

def download(url, target, checksum):
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == checksum:
        return
    with urllib.request.urlopen(url, timeout=120) as r, target.open('wb') as out:
        while chunk := r.read(1024 * 1024): out.write(chunk)
    if hashlib.sha256(target.read_bytes()).hexdigest() != checksum:
        raise RuntimeError('Checksum mismatch: ' + target.name)

def java():
    if (root/'jdk/bin/java.exe').exists(): return
    url = 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
    try:
        package = json.load(urllib.request.urlopen(url, timeout=60))[0]['binary']['package']
    except Exception:
        fallback = 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip'
        resolved = urllib.request.urlopen(urllib.request.Request(fallback, method='HEAD'), timeout=60).url
        filename = resolved.rsplit('/', 1)[-1]
        checksum = urllib.request.urlopen('https://aka.ms/download-jdk/' + filename + '.sha256sum.txt', timeout=60).read().decode().split()[0]
        package = {'link':fallback, 'checksum':checksum}
    archive = root/'jdk.zip'; download(package['link'], archive, package['checksum'])
    with zipfile.ZipFile(archive) as z:
        prefix = z.namelist()[0].split('/')[0] + '/'
        for info in z.infolist():
            relative = info.filename.removeprefix(prefix)
            if not relative or info.is_dir(): continue
            target = root/'jdk'/relative; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(info))
    print('JDK 21 ready', flush=True)

def sdk():
    if (root/'sdk/cmdline-tools/latest/bin/sdkmanager.bat').exists(): return
    archive = root/'cmdline-tools.zip'
    download('https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip', archive,
             '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a')
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            relative = info.filename.removeprefix('cmdline-tools/')
            if not relative or info.is_dir(): continue
            target = root/'sdk/cmdline-tools/latest'/relative
            target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(z.read(info))
    print('Android command line tools ready', flush=True)

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lambda f: f(), [java, sdk]): pass
