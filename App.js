import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';

const dbPromise = SQLite.openDatabaseAsync('sales-debts.db');
const colors = {
  background: '#f5f7fb',
  card: '#ffffff',
  ink: '#172033',
  muted: '#718096',
  primary: '#3157d5',
  border: '#e5e9f2',
  green: '#17834b',
  red: '#c83e4d',
  amber: '#a96508',
};

const money = (value) => Number(value || 0).toLocaleString('ar', { maximumFractionDigits: 2 });
const dateToday = () => new Date().toISOString().slice(0, 10);

async function initializeDatabase() {
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      payment_type TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      due_date TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      FOREIGN KEY(debt_id) REFERENCES debts(id)
    );
  `);
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default' }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor="#9aa4b5"
        keyboardType={keyboardType}
        textAlign="right"
      />
    </View>
  );
}

function ActionButton({ title, onPress, secondary = false, compact = false }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, compact && styles.compactButton]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</Text>
    </Pressable>
  );
}

function SectionTitle({ title, action, onAction }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Pressable onPress={onAction}><Text style={styles.link}>{action}</Text></Pressable> : null}
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState('home');
  const [summary, setSummary] = useState({ sales: 0, outstanding: 0, customers: 0, todaySales: 0 });
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [debts, setDebts] = useState([]);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(true);

  const refresh = async () => {
    try {
      const db = await dbPromise;
      const [customerRows, saleRows, debtRows, totals] = await Promise.all([
        db.getAllAsync('SELECT * FROM customers ORDER BY id DESC'),
        db.getAllAsync(`SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.id DESC`),
        db.getAllAsync(`
          SELECT d.*, c.name AS customer_name,
            d.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.debt_id = d.id), 0) AS remaining
          FROM debts d LEFT JOIN customers c ON c.id = d.customer_id ORDER BY d.id DESC
        `),
        db.getFirstAsync(`
          SELECT COALESCE((SELECT SUM(total) FROM sales), 0) AS sales,
            COALESCE((SELECT SUM(d.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.debt_id=d.id),0)) FROM debts d),0) AS outstanding,
            (SELECT COUNT(*) FROM customers) AS customers,
            COALESCE((SELECT SUM(total) FROM sales WHERE sale_date = ?),0) AS todaySales
        `, dateToday()),
      ]);
      setCustomers(customerRows);
      setSales(saleRows);
      setDebts(debtRows);
      setSummary(totals || { sales: 0, outstanding: 0, customers: 0, todaySales: 0 });
    } catch (error) {
      Alert.alert('تعذّر تحميل البيانات', error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    initializeDatabase().then(refresh).catch((error) => {
      setBusy(false);
      Alert.alert('تعذّر فتح قاعدة البيانات', error.message);
    });
  }, []);

  const addCustomer = async (form) => {
    if (!form.name.trim()) return Alert.alert('تنبيه', 'اكتب اسم العميل.');
    const db = await dbPromise;
    await db.runAsync('INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)', form.name.trim(), form.phone.trim(), dateToday());
    setModal(null);
    await refresh();
  };

  const addSale = async (form) => {
    const quantity = Number(form.quantity);
    const unitPrice = Number(form.price);
    if (!form.item.trim() || !form.customerId || quantity <= 0 || unitPrice < 0 || !Number.isFinite(unitPrice)) {
      return Alert.alert('تحقق من البيانات', 'اختر العميل واكتب المنتج والكمية والسعر بشكل صحيح.');
    }
    const db = await dbPromise;
    const total = quantity * unitPrice;
    const result = await db.runAsync(
      'INSERT INTO sales (customer_id, item_name, quantity, unit_price, total, payment_type, sale_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      Number(form.customerId), form.item.trim(), quantity, unitPrice, total, form.paymentType, dateToday(),
    );
    if (form.paymentType === 'credit') {
      await db.runAsync('INSERT INTO debts (customer_id, description, amount, created_at) VALUES (?, ?, ?, ?)', Number(form.customerId), `بيع: ${form.item.trim()}`, total, dateToday());
    }
    setModal(null);
    await refresh();
    Alert.alert('تم الحفظ', 'تم تسجيل البيع بنجاح.');
  };

  const addDebt = async (form) => {
    const amount = Number(form.amount);
    if (!form.customerId || !form.description.trim() || amount <= 0 || !Number.isFinite(amount)) {
      return Alert.alert('تحقق من البيانات', 'اختر العميل واكتب وصف الدين ومبلغًا صحيحًا.');
    }
    const db = await dbPromise;
    await db.runAsync('INSERT INTO debts (customer_id, description, amount, due_date, created_at) VALUES (?, ?, ?, ?, ?)', Number(form.customerId), form.description.trim(), amount, form.dueDate.trim(), dateToday());
    setModal(null);
    await refresh();
    Alert.alert('تم الحفظ', 'تم تسجيل الدين.');
  };

  const payDebt = (debt) => {
    Alert.prompt?.('تسجيل تسديد', `المتبقي: ${money(debt.remaining)}`, async (text) => {
      const amount = Number(text);
      if (amount <= 0 || amount > Number(debt.remaining)) return Alert.alert('مبلغ غير صحيح', 'أدخل مبلغًا لا يتجاوز المتبقي.');
      const db = await dbPromise;
      await db.runAsync('INSERT INTO payments (debt_id, amount, payment_date) VALUES (?, ?, ?)', debt.id, amount, dateToday());
      await refresh();
      Alert.alert('تم التسديد', 'تم تسجيل الدفعة.');
    }, 'plain-text', String(debt.remaining), 'decimal-pad');
    if (!Alert.prompt && Platform.OS !== 'ios') setModal({ type: 'payment', debt });
  };

  const savePayment = async (form) => {
    const amount = Number(form.amount);
    const debt = modal.debt;
    if (amount <= 0 || amount > Number(debt.remaining)) return Alert.alert('مبلغ غير صحيح', 'أدخل مبلغًا لا يتجاوز المتبقي.');
    const db = await dbPromise;
    await db.runAsync('INSERT INTO payments (debt_id, amount, payment_date) VALUES (?, ?, ?)', debt.id, amount, dateToday());
    setModal(null);
    await refresh();
    Alert.alert('تم التسديد', 'تم تسجيل الدفعة.');
  };

  const openForm = (type) => {
    if (type !== 'customer' && customers.length === 0) {
      Alert.alert('أضف عميلًا أولًا', 'سجّل اسم العميل قبل إضافة بيع أو دين.');
      setTab('customers');
      return;
    }
    setModal({ type });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>دفتر متجرك</Text>
          <Text style={styles.headerTitle}>البيع والديون</Text>
        </View>
        <Pressable style={styles.refreshButton} onPress={refresh}><Text style={styles.refreshText}>↻</Text></Pressable>
      </View>

      {busy ? <View style={styles.loading}><Text style={styles.muted}>جارٍ تحميل السجل…</Text></View> : (
        <>
          {tab === 'home' && <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.greeting}>ملخص نشاطك</Text>
            <Text style={styles.muted}>كل الأرقام محفوظة على هذا الجهاز.</Text>
            <View style={styles.statsGrid}>
              <StatCard label="مبيعات اليوم" value={money(summary.todaySales)} accent={colors.primary} />
              <StatCard label="إجمالي المبيعات" value={money(summary.sales)} accent={colors.green} />
              <StatCard label="الديون المتبقية" value={money(summary.outstanding)} accent={colors.red} />
              <StatCard label="العملاء" value={money(summary.customers)} accent={colors.amber} />
            </View>
            <SectionTitle title="إجراءات سريعة" />
            <View style={styles.quickActions}>
              <ActionButton title="＋ بيع جديد" onPress={() => openForm('sale')} />
              <ActionButton title="＋ تسجيل دين" secondary onPress={() => openForm('debt')} />
            </View>
            <SectionTitle title="آخر المبيعات" action="عرض الكل" onAction={() => setTab('sales')} />
            {sales.slice(0, 4).map((item) => <SaleRow key={item.id} item={item} />)}
            {sales.length === 0 && <Empty text="لا توجد مبيعات بعد." />}
          </ScrollView>}

          {tab === 'sales' && <View style={styles.page}>
            <SectionTitle title="سجل المبيعات" action="＋ إضافة" onAction={() => openForm('sale')} />
            <FlatList data={sales} keyExtractor={(item) => String(item.id)} contentContainerStyle={styles.listContent}
              ListEmptyComponent={<Empty text="لا توجد مبيعات مسجلة." />}
              renderItem={({ item }) => <SaleRow item={item} />} />
          </View>}

          {tab === 'debts' && <View style={styles.page}>
            <SectionTitle title="سجل الديون" action="＋ إضافة" onAction={() => openForm('debt')} />
            <FlatList data={debts} keyExtractor={(item) => String(item.id)} contentContainerStyle={styles.listContent}
              ListEmptyComponent={<Empty text="لا توجد ديون مسجلة." />}
              renderItem={({ item }) => <DebtRow item={item} onPay={() => payDebt(item)} />} />
          </View>}

          {tab === 'customers' && <View style={styles.page}>
            <SectionTitle title="العملاء" action="＋ إضافة" onAction={() => openForm('customer')} />
            <FlatList data={customers} keyExtractor={(item) => String(item.id)} contentContainerStyle={styles.listContent}
              ListEmptyComponent={<Empty text="أضف أول عميل للبدء." />}
              renderItem={({ item }) => <View style={styles.rowCard}><View style={styles.avatar}><Text style={styles.avatarText}>{item.name.slice(0, 1)}</Text></View><View style={styles.rowMain}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowSub}>{item.phone || 'بدون رقم هاتف'}</Text></View></View>} />
          </View>}
        </>
      )}

      <View style={styles.tabBar}>
        <TabButton label="الرئيسية" icon="⌂" active={tab === 'home'} onPress={() => setTab('home')} />
        <TabButton label="المبيعات" icon="▤" active={tab === 'sales'} onPress={() => setTab('sales')} />
        <TabButton label="الديون" icon="◷" active={tab === 'debts'} onPress={() => setTab('debts')} />
        <TabButton label="العملاء" icon="♙" active={tab === 'customers'} onPress={() => setTab('customers')} />
      </View>

      <FormModal modal={modal} customers={customers} onClose={() => setModal(null)} onSave={{ customer: addCustomer, sale: addSale, debt: addDebt, payment: savePayment }} />
    </SafeAreaView>
  );
}

function StatCard({ label, value, accent }) {
  return <View style={styles.statCard}><View style={[styles.statAccent, { backgroundColor: accent }]} /><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>;
}

function SaleRow({ item }) {
  return <View style={styles.rowCard}><View style={styles.rowMain}><Text style={styles.rowTitle}>{item.item_name} · {item.customer_name || 'عميل'}</Text><Text style={styles.rowSub}>{item.sale_date} · {item.quantity} × {money(item.unit_price)} · {item.payment_type === 'credit' ? 'آجل' : 'نقدي'}</Text></View><Text style={styles.rowAmount}>{money(item.total)}</Text></View>;
}

function DebtRow({ item, onPay }) {
  const remaining = Number(item.remaining || 0);
  return <View style={styles.rowCard}><View style={styles.rowMain}><Text style={styles.rowTitle}>{item.customer_name || 'عميل'}</Text><Text style={styles.rowSub}>{item.description} · {item.created_at}</Text><Text style={[styles.debtRemaining, remaining === 0 && { color: colors.green }]}>{remaining === 0 ? 'مسدد بالكامل' : `المتبقي: ${money(remaining)}`}</Text></View>{remaining > 0 && <ActionButton title="تسديد" compact onPress={onPay} />}</View>;
}

function Empty({ text }) { return <View style={styles.empty}><Text style={styles.emptyIcon}>▤</Text><Text style={styles.muted}>{text}</Text></View>; }

function TabButton({ label, icon, active, onPress }) {
  return <Pressable onPress={onPress} style={styles.tabItem}><Text style={[styles.tabIcon, active && styles.tabActive]}>{icon}</Text><Text style={[styles.tabLabel, active && styles.tabActive]}>{label}</Text></Pressable>;
}

function FormModal({ modal, customers, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', phone: '', item: '', customerId: '', quantity: '1', price: '', paymentType: 'cash', amount: '', description: '', dueDate: '' });
  useEffect(() => {
    setForm({ name: '', phone: '', item: '', customerId: customers[0] ? String(customers[0].id) : '', quantity: '1', price: '', paymentType: 'cash', amount: '', description: '', dueDate: '' });
  }, [modal?.type]);
  if (!modal) return null;
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const title = { customer: 'إضافة عميل', sale: 'تسجيل بيع', debt: 'تسجيل دين', payment: 'تسجيل تسديد' }[modal.type];
  const submit = () => onSave[modal.type](form);

  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.modalCard}>
        <View style={styles.modalHeading}><Text style={styles.modalTitle}>{title}</Text><Pressable onPress={onClose}><Text style={styles.close}>×</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {modal.type === 'customer' && <><Field label="اسم العميل" value={form.name} onChangeText={(v) => change('name', v)} /><Field label="رقم الهاتف (اختياري)" value={form.phone} onChangeText={(v) => change('phone', v)} keyboardType="phone-pad" /></>}
          {modal.type === 'sale' && <>
            <PickerField label="العميل" value={form.customerId} options={customers.map((c) => ({ value: String(c.id), label: c.name }))} onChange={(v) => change('customerId', v)} />
            <Field label="اسم المنتج" value={form.item} onChangeText={(v) => change('item', v)} />
            <Field label="الكمية" value={form.quantity} onChangeText={(v) => change('quantity', v)} keyboardType="decimal-pad" />
            <Field label="سعر الوحدة" value={form.price} onChangeText={(v) => change('price', v)} keyboardType="decimal-pad" />
            <View style={styles.choiceRow}><Choice label="نقدي" active={form.paymentType === 'cash'} onPress={() => change('paymentType', 'cash')} /><Choice label="آجل" active={form.paymentType === 'credit'} onPress={() => change('paymentType', 'credit')} /></View>
          </>}
          {modal.type === 'debt' && <><PickerField label="العميل" value={form.customerId} options={customers.map((c) => ({ value: String(c.id), label: c.name }))} onChange={(v) => change('customerId', v)} /><Field label="وصف الدين" value={form.description} onChangeText={(v) => change('description', v)} /><Field label="المبلغ" value={form.amount} onChangeText={(v) => change('amount', v)} keyboardType="decimal-pad" /><Field label="تاريخ الاستحقاق (اختياري، YYYY-MM-DD)" value={form.dueDate} onChangeText={(v) => change('dueDate', v)} /></>}
          {modal.type === 'payment' && <><Text style={styles.paymentHint}>المتبقي على {modal.debt.customer_name}: {money(modal.debt.remaining)}</Text><Field label="مبلغ التسديد" value={form.amount} onChangeText={(v) => change('amount', v)} keyboardType="decimal-pad" /></>}
          <ActionButton title="حفظ" onPress={submit} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function PickerField({ label, value, options, onChange }) {
  const selected = options.find((option) => option.value === value);
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerOptions}>{options.map((option) => <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.choice, value === option.value && styles.choiceActive]}><Text style={[styles.choiceText, value === option.value && styles.choiceTextActive]}>{option.label}</Text></Pressable>)}</ScrollView>{!selected && <Text style={styles.muted}>اختر عميلًا</Text>}</View>;
}

function Choice({ label, active, onPress }) {
  return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === 'android' ? 8 : 0 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  headerTitle: { color: colors.ink, fontSize: 25, fontWeight: '800', textAlign: 'right', marginTop: 3 },
  refreshButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: colors.primary, fontSize: 26, fontWeight: '700' },
  content: { paddingHorizontal: 18, paddingBottom: 24 },
  greeting: { textAlign: 'right', color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: 4 },
  muted: { color: colors.muted, fontSize: 13, textAlign: 'right', marginTop: 5 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 18 },
  statCard: { width: '48%', backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12, minHeight: 105, justifyContent: 'center' },
  statAccent: { width: 26, height: 4, borderRadius: 4, alignSelf: 'flex-end', marginBottom: 10 },
  statLabel: { color: colors.muted, textAlign: 'right', fontSize: 12 },
  statValue: { color: colors.ink, textAlign: 'right', fontSize: 22, fontWeight: '800', marginTop: 5 },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 17, marginBottom: 10 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  link: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  quickActions: { flexDirection: 'row', gap: 10 },
  button: { minHeight: 46, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  secondaryButton: { backgroundColor: '#e9edff' },
  secondaryButtonText: { color: colors.primary },
  compactButton: { minHeight: 36, marginTop: 0, paddingHorizontal: 13 },
  page: { flex: 1, paddingHorizontal: 18 },
  listContent: { paddingBottom: 18, flexGrow: 1 },
  rowCard: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.ink, textAlign: 'right', fontSize: 14, fontWeight: '700' },
  rowSub: { color: colors.muted, textAlign: 'right', fontSize: 12, marginTop: 5 },
  rowAmount: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  debtRemaining: { color: colors.red, textAlign: 'right', fontSize: 12, fontWeight: '700', marginTop: 6 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#e9edff', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '800', fontSize: 18 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 42, gap: 8 },
  emptyIcon: { color: '#b8c2d4', fontSize: 30 },
  tabBar: { flexDirection: 'row', backgroundColor: colors.card, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 18 : 10 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabIcon: { color: colors.muted, fontSize: 21 },
  tabLabel: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  tabActive: { color: colors.primary, fontWeight: '800' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.38)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: '90%' },
  modalHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  close: { color: colors.muted, fontSize: 30, lineHeight: 32 },
  field: { marginBottom: 12 },
  fieldLabel: { color: colors.ink, textAlign: 'right', fontSize: 13, fontWeight: '700', marginBottom: 7 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 13, color: colors.ink },
  choiceRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 8 },
  pickerOptions: { flexGrow: 1, justifyContent: 'flex-end', gap: 8, paddingVertical: 2 },
  choice: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  choiceActive: { borderColor: colors.primary, backgroundColor: '#e9edff' },
  choiceText: { color: colors.muted, fontWeight: '700', textAlign: 'right' },
  choiceTextActive: { color: colors.primary },
  paymentHint: { color: colors.muted, fontSize: 14, textAlign: 'right', marginBottom: 12 },
});
