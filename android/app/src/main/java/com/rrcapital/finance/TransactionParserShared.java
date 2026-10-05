package com.rrcapital.finance;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Shared, strictly on-device parser for SMS and notification transaction text. */
public final class TransactionParserShared {
    private static final Pattern CURRENCY_AMOUNT = Pattern.compile("(?i)(?:\\x{20B9}|INR|Rs\\.?)[ \\t]*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)[ \\t]*(?:INR|Rs\\.?|\\x{20B9})");
    private static final Pattern DEBIT = Pattern.compile("(?i)\\b(debited|withdrawn|spent|purchase|paid|payment|sent|transferred)\\b");
    private static final Pattern CREDIT = Pattern.compile("(?i)\\b(credited|received|refund|deposited|cashback)\\b");
    private static final Pattern MERCHANT = Pattern.compile("(?i)\\b(?:at|to)\\s+([A-Za-z0-9&._ -]{2,36}?)(?:\\s+(?:on|using|via|ref|upi|card|ending|from|account|a/c)\\b|[.;,]|$)");
    private static final Pattern ACCOUNT_SUFFIX = Pattern.compile("(?i)(?:a/c|acct|account|card)(?:\\s*(?:no\\.?|number|ending))?\\s*[:#-]?\\s*(?:x{2,}|\\*+)?([0-9]{3,6})\\b|(?:ending|xx|\\*+)([0-9]{3,6})\\b");
    private static final String[][] BANKS = {
        {"HDFC Bank", "HDFC"}, {"ICICI Bank", "ICICI"}, {"State Bank of India", "SBI", "SBIN"},
        {"Axis Bank", "AXIS"}, {"Kotak Mahindra Bank", "KOTAK"}, {"IDFC FIRST Bank", "IDFC"},
        {"IndusInd Bank", "INDUSIND"}, {"Yes Bank", "YESBANK"}, {"Punjab National Bank", "PNB"},
        {"Bank of Baroda", "BARODA", "BOB"}, {"Canara Bank", "CANARA"}, {"Federal Bank", "FEDERAL"},
        {"RBL Bank", "RBL"}, {"AU Small Finance Bank", "AU BANK"}, {"Airtel Payments Bank", "AIRTEL"}
    };

    private TransactionParserShared() {}

    public static ParsedTransaction parse(String source, String text, long receivedAt) {
        return parse(source, text, "", receivedAt);
    }

    public static ParsedTransaction parse(String source, String text, String senderOrTitle, long receivedAt) {
        if (text == null || text.length() > 12000) return null;
        Matcher amountMatch = CURRENCY_AMOUNT.matcher(text);
        if (!amountMatch.find()) return null;
        String rawAmount = amountMatch.group(1) != null ? amountMatch.group(1) : amountMatch.group(2);
        final double amount;
        try { amount = Double.parseDouble(rawAmount.replace(",", "")); }
        catch (NumberFormatException ignored) { return null; }
        if (!Double.isFinite(amount) || amount <= 0 || amount > 1000000000d) return null;

        Matcher debit = DEBIT.matcher(text);
        Matcher credit = CREDIT.matcher(text);
        boolean hasDebit = debit.find();
        boolean hasCredit = credit.find();
        if (hasDebit == hasCredit) return null; // Ambiguous/unknown is not imported.
        String direction = hasDebit ? "expense" : "income";
        Matcher merchant = MERCHANT.matcher(text);
        String description = merchant.find() ? merchant.group(1).trim() : (hasDebit ? "Card / bank expense" : "Bank credit");
        if (description.length() > 48) description = description.substring(0, 48).trim();

        String context = (senderOrTitle == null ? "" : senderOrTitle) + " " + text;
        String bank = findBank(context);
        Matcher suffix = ACCOUNT_SUFFIX.matcher(text);
        String accountSuffix = suffix.find() ? (suffix.group(1) != null ? suffix.group(1) : suffix.group(2)) : "";
        return new ParsedTransaction(fingerprint(source, text, receivedAt, amount), amount, direction,
            hasDebit ? "debit" : "credit", description, bank, accountSuffix, source, receivedAt);
    }

    private static String findBank(String text) {
        String normalized = text.toUpperCase(Locale.ROOT);
        for (String[] bank : BANKS) {
            for (String alias : bank) if (normalized.contains(alias.toUpperCase(Locale.ROOT))) return bank[0];
        }
        return "";
    }

    private static String fingerprint(String source, String text, long time, double amount) {
        try {
            // The digest is used only for local deduplication; raw message text is never persisted.
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String normalized = (source + "|" + amount + "|" + (time / 60000L) + "|" + text.toLowerCase(Locale.ROOT)).trim();
            byte[] hash = digest.digest(normalized.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(32);
            for (int i = 0; i < 16; i++) hex.append(String.format(Locale.ROOT, "%02x", hash[i]));
            return hex.toString();
        } catch (Exception impossible) { return Long.toHexString(time) + Long.toHexString(Double.doubleToLongBits(amount)); }
    }

    public static final class ParsedTransaction {
        public final String id, direction, transactionType, description, bank, accountSuffix, source;
        public final double amount;
        public final long receivedAt;
        ParsedTransaction(String id, double amount, String direction, String transactionType, String description,
                          String bank, String accountSuffix, String source, long receivedAt) {
            this.id = id; this.amount = amount; this.direction = direction; this.transactionType = transactionType;
            this.description = description; this.bank = bank; this.accountSuffix = accountSuffix;
            this.source = source; this.receivedAt = receivedAt;
        }
    }
}
