package com.ardacore.kaitrad;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.Toast;

final class KaiTradNavigationPolicy {
    static final String FRONTEND_HOST = "kai-sanban.nadmo.id";
    static final String LEGACY_FRONTEND_HOST = "kai-trad-pwa.ardarawk.workers.dev";

    private KaiTradNavigationPolicy() {}

    static boolean isCanonicalInternal(Uri uri) {
        if (uri == null) return false;
        return "https".equalsIgnoreCase(uri.getScheme())
                && FRONTEND_HOST.equalsIgnoreCase(uri.getHost());
    }

    static boolean isLegacyInternal(Uri uri) {
        if (uri == null) return false;
        return "https".equalsIgnoreCase(uri.getScheme())
                && LEGACY_FRONTEND_HOST.equalsIgnoreCase(uri.getHost());
    }

    static boolean isInternal(Uri uri) {
        return isCanonicalInternal(uri) || isLegacyInternal(uri);
    }

    static Uri canonicalize(Uri uri) {
        if (!isLegacyInternal(uri)) return uri;
        return uri.buildUpon()
                .authority(FRONTEND_HOST)
                .build();
    }

    static boolean openExternal(Context context, Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!(scheme.equals("https") || scheme.equals("mailto") || scheme.equals("tel"))) {
            Toast.makeText(context, "Tautan diblokir oleh KAI TRAD.", Toast.LENGTH_SHORT).show();
            return true;
        }
        try {
            context.startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) {
            Toast.makeText(context, "Tidak ada aplikasi untuk membuka tautan ini.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }
}
