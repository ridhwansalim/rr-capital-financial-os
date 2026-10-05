package com.rrcapital.finance;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

@CapacitorPlugin(name = "NativeApkUpdater")
public final class NativeApkUpdatePlugin extends Plugin {
    private static final String ALLOWED_HOST = "financial-os-orcin-ten.vercel.app";
    private static final long MAX_APK_BYTES = 150L * 1024L * 1024L;

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException error) {
            call.reject("Could not read the installed app version.", error);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String urlValue = call.getString("url", "");
        String expectedHash = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        long versionCode = call.getLong("versionCode", -1L);
        if (!expectedHash.matches("[a-f0-9]{64}") || versionCode <= 0) {
            call.reject("The Android update manifest is missing a valid version or checksum.");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent permissionIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(permissionIntent);
            JSObject result = new JSObject();
            result.put("permissionRequired", true);
            call.resolve(result);
            return;
        }

        new Thread(() -> downloadVerifyAndOpen(call, urlValue, expectedHash, versionCode)).start();
    }

    private void downloadVerifyAndOpen(PluginCall call, String urlValue, String expectedHash, long versionCode) {
        File tempFile = null;
        HttpURLConnection connection = null;
        try {
            PackageInfo installed = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long installedCode = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
            if (versionCode <= installedCode) {
                call.reject("This APK is not newer than the installed version.");
                return;
            }

            URL url = new URL(urlValue);
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !ALLOWED_HOST.equalsIgnoreCase(url.getHost())) {
                call.reject("The Android APK URL is not from the trusted release host.");
                return;
            }
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(45000);
            connection.setInstanceFollowRedirects(false);
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                URL redirected = location == null ? null : new URL(url, location);
                if (redirected == null || !"https".equalsIgnoreCase(redirected.getProtocol()) || !ALLOWED_HOST.equalsIgnoreCase(redirected.getHost())) {
                    call.reject("The APK download redirected to an untrusted host.");
                    return;
                }
                connection.disconnect();
                connection = (HttpURLConnection) redirected.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(45000);
                status = connection.getResponseCode();
            }
            if (status != HttpURLConnection.HTTP_OK) {
                call.reject("The APK download failed (HTTP " + status + ").");
                return;
            }
            long contentLength = connection.getContentLengthLong();
            if (contentLength > MAX_APK_BYTES) {
                call.reject("The Android update file is larger than the allowed size.");
                return;
            }

            File directory = new File(getContext().getCacheDir(), "apk-updates");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Could not prepare the APK cache directory.");
            tempFile = new File(directory, "RR-Capital.apk.part");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long totalBytes = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(tempFile)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    totalBytes += count;
                    if (totalBytes > MAX_APK_BYTES) throw new IllegalStateException("The Android update file is larger than the allowed size.");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            StringBuilder actualHash = new StringBuilder();
            for (byte value : digest.digest()) actualHash.append(String.format(Locale.ROOT, "%02x", value));
            if (!expectedHash.equals(actualHash.toString())) throw new SecurityException("The APK checksum did not match the release manifest.");

            File apkFile = new File(directory, "RR-Capital.apk");
            if (apkFile.exists() && !apkFile.delete()) throw new IllegalStateException("Could not replace the cached APK.");
            if (!tempFile.renameTo(apkFile)) throw new IllegalStateException("Could not finalize the downloaded APK.");

            Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apkFile);
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            installIntent.setClipData(ClipData.newUri(getContext().getContentResolver(), "RR Capital update", apkUri));
            getContext().startActivity(installIntent);
            JSObject result = new JSObject();
            result.put("permissionRequired", false);
            result.put("downloadedBytes", totalBytes);
            call.resolve(result);
        } catch (Exception error) {
            if (tempFile != null && tempFile.exists()) tempFile.delete();
            call.reject(error.getMessage() == null ? "Could not download or open the Android update." : error.getMessage(), error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
