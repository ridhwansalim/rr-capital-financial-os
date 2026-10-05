package com.rrcapital.finance;

import static org.junit.Assert.*;
import org.junit.Test;

public class TransactionParserTest {
    @Test public void parsesDebitAndKeepsOnlyMerchantSummary() {
        TransactionParserShared.ParsedTransaction value = TransactionParserShared.parse(
            "sms", "Rs. 1,250.50 debited from account at Grocery World on 05-Oct. Ref 938272", "Acme Bank", 1000L);
        assertNotNull(value);
        assertEquals(1250.50, value.amount, 0.001);
        assertEquals("expense", value.direction);
        assertEquals("debit", value.transactionType);
        assertEquals("Grocery World", value.description);
    }

    @Test public void parsesCredit() {
        TransactionParserShared.ParsedTransaction value = TransactionParserShared.parse(
            "notification", "INR 500.00 credited to your account as refund", 1000L);
        assertNotNull(value);
        assertEquals("income", value.direction);
        assertEquals("credit", value.transactionType);
    }

    @Test public void parsesActualRupeeSymbolBankAndMaskedAccountSuffix() {
        TransactionParserShared.ParsedTransaction value = TransactionParserShared.parse(
            "sms", "INR alert: \u20B92,450 debited at Fuel Station from A/c XX1234", "HDFCBK", 2000L);
        assertNotNull(value);
        assertEquals(2450d, value.amount, 0.001);
        assertEquals("expense", value.direction);
        assertEquals("debit", value.transactionType);
        assertEquals("Fuel Station", value.description);
        assertEquals("HDFC Bank", value.bank);
        assertEquals("1234", value.accountSuffix);
    }

    @Test public void ignoresAmbiguousAndCurrencyFreeMessages() {
        assertNull(TransactionParserShared.parse("sms", "Your account balance is 1000", 1000L));
        assertNull(TransactionParserShared.parse("sms", "Rs 1000 transaction processed", 1000L));
        assertNull(TransactionParserShared.parse("sms", "Rs 1000 debited and Rs 1000 credited", 1000L));
    }
}
