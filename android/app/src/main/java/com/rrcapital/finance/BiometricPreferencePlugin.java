package com.rrcapital.finance;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Stores an owner-scoped biometric opt-in encrypted by a non-exportable Android Keystore key. */
@CapacitorPlugin(name = "BiometricPreference")
public final class BiometricPreferencePlugin extends Plugin {
    private static final String KEY_ALIAS = "rr.capital.biometric.preference.v1";
    private static final String PREFS = "rr_biometric_preference_v1";
    private static final String VALUE_KEY = "encrypted_owner_opt_in";

    @PluginMethod public void setEnabled(PluginCall call) {
        String ownerId = call.getString("ownerId", "");
        boolean enabled = call.getBoolean("enabled", false);
        if (ownerId.isEmpty()) { call.reject("A signed-in owner is required."); return; }
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
            if (!enabled) {
                String saved = prefs.getString(VALUE_KEY, null);
                if (saved != null && ownerId.equals(decrypt(saved))) prefs.edit().remove(VALUE_KEY).apply();
            } else {
                prefs.edit().putString(VALUE_KEY, encrypt(ownerId)).apply();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not securely store the biometric preference.");
        }
    }

    @PluginMethod public void isEnabled(PluginCall call) {
        String ownerId = call.getString("ownerId", "");
        if (ownerId.isEmpty()) { call.resolve(new com.getcapacitor.JSObject().put("enabled", false)); return; }
        try {
            String saved = getContext().getSharedPreferences(PREFS, 0).getString(VALUE_KEY, null);
            boolean enabled = saved != null && ownerId.equals(decrypt(saved));
            call.resolve(new com.getcapacitor.JSObject().put("enabled", enabled));
        } catch (Exception error) {
            getContext().getSharedPreferences(PREFS, 0).edit().remove(VALUE_KEY).apply();
            call.resolve(new com.getcapacitor.JSObject().put("enabled", false));
        }
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        ByteBuffer payload = ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted);
        return Base64.encodeToString(payload.array(), Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        byte[] payload = Base64.decode(value, Base64.NO_WRAP);
        ByteBuffer buffer = ByteBuffer.wrap(payload);
        byte[] iv = new byte[12];
        buffer.get(iv);
        byte[] encrypted = new byte[buffer.remaining()];
        buffer.get(encrypted);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key existing = store.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
