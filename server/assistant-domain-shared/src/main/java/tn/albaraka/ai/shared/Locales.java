package tn.albaraka.ai.shared;

/** Locale helpers for the trilingual surface (fr-FR primary, ar-TN RTL, en-GB). */
public final class Locales {
    private Locales() {}

    public static String dirOf(String locale) {
        return locale != null && locale.toLowerCase().startsWith("ar") ? "rtl" : "ltr";
    }

    public static boolean isRtl(String locale) {
        return "rtl".equals(dirOf(locale));
    }
}
