package com.rrcapital.finance;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Switches launcher aliases without killing or recreating the running activity. */
@CapacitorPlugin(name = "LauncherIcon")
public final class LauncherIconPlugin extends Plugin {
    private static final String[] ICONS = { "system", "dark", "cream", "monochrome" };
    private static final String[] ALIASES = {
        ".DefaultIcon", ".InvertedDarkIcon", ".LightBrandIcon", ".MonochromeIcon"
    };

    @PluginMethod
    public void setIcon(PluginCall call) {
        String icon = call.getString("icon", "");
        int selected = indexOf(icon);
        if (selected < 0) {
            call.reject("Unsupported launcher icon.");
            return;
        }

        PackageManager manager = getContext().getPackageManager();
        try {
            // Enable the destination first so there is never a moment with no launcher entry.
            manager.setComponentEnabledSetting(component(ALIASES[selected]),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            for (int index = 0; index < ALIASES.length; index++) {
                if (index == selected) continue;
                manager.setComponentEnabledSetting(component(ALIASES[index]),
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            }
            call.resolve(new JSObject().put("icon", ICONS[selected]));
        } catch (RuntimeException error) {
            call.reject("Android could not change the launcher icon.", error);
        }
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        PackageManager manager = getContext().getPackageManager();
        for (int index = 0; index < ALIASES.length; index++) {
            int state = manager.getComponentEnabledSetting(component(ALIASES[index]));
            if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                || (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && index == 0)) {
                call.resolve(new JSObject().put("icon", ICONS[index]));
                return;
            }
        }
        call.resolve(new JSObject().put("icon", "system"));
    }

    private ComponentName component(String alias) {
        return new ComponentName(getContext(), getContext().getPackageName() + alias);
    }

    private int indexOf(String icon) {
        for (int index = 0; index < ICONS.length; index++) {
            if (ICONS[index].equals(icon)) return index;
        }
        return -1;
    }
}
