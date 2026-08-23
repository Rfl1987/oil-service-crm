const { createClient } = supabase;

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- Auth ---------- */

async function initAuth() {
  const { data } = await db.auth.getSession();

  if (data && data.session) {
    enterApp();
  } else {
    document.getElementById("loginScreen").classList.remove("hidden");
    document.getElementById("appShell").classList.add("hidden");
  }
}

function enterApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  showView("dashboard");
}

async function login(event) {
  event.preventDefault();

  const email = document.getElementById("login_email").value.trim();
  const password = document.getElementById("login_password").value;

  const { error } = await db.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    alert("Giriş xətası: " + error.message);
    return;
  }

  enterApp();
}

async function logout() {
  await db.auth.signOut();
  location.reload();
}

/* ---------- Görünüşlər ---------- */

function showView(name) {
  document.querySelectorAll(".view").forEach(function (v) {
    v.classList.add("hidden");
  });

  const el = document.getElementById("view-" + name);
  if (el) el.classList.remove("hidden");

  document.querySelectorAll("nav button").forEach(function (b) {
    b.classList.remove("active");
  });

  const btn = document.getElementById("nav-" + name);
  if (btn) btn.classList.add("active");

  if (name === "dashboard") loadDashboard();
  if (name === "customers") loadCustomers();
  if (name === "vehicles") loadVehicles();
  if (name === "order") {
    loadOrderCustomers();
    loadOrders();
  }
}

/* ---------- Kliklənən statistika ---------- */

document.addEventListener("click", function (e) {
  const item = e.target.closest("#dashboard .item");
  if (!item) return;

  const items = Array.from(document.querySelectorAll("#dashboard .item"));
  if (items.length < 3) return;

  const idx = items.indexOf(item);

  if (idx === 0) showView("customers");
  else if (idx === 1) showView("vehicles");
  else if (idx === 2) showView("order");
});

/* ---------- Dashboard ---------- */

async function loadDashboard() {
  const box = document.getElementById("dashboard");
  box.innerHTML = '<div class="item"><div class="small">Yüklənir...</div></div>';

  const c = await db.from("customers").select("*", { count: "exact", head: true });
  const v = await db.from("vehicles").select("*", { count: "exact", head: true });
  const o = await db.from("service_orders").select("*", { count: "exact", head: true });

  box.innerHTML =
    '<div class="item"><div class="small">Müştərilər</div><div class="big">' + (c.count || 0) + "</div></div>" +
    '<div class="item"><div class="small">Avtomobillər</div><div class="big">' + (v.count || 0) + "</div></div>" +
    '<div class="item"><div class="small">Sifarişlər</div><div class="big">' + (o.count || 0) + "</div></div>";

  loadReminders();
}

/* ---------- Xatırlatmalar ---------- */

let remindersCache = {};

async function loadReminders() {
  const box = document.getElementById("reminders");
  if (!box) return;

  box.innerHTML = '<div class="small">Yüklənir...</div>';

  const { data, error } = await db
    .from("service_orders")
    .select("*, customers(full_name, phone, whatsapp_phone), vehicles(brand, model, plate_number, last_mileage)")
    .order("created_at", { ascending: false });

  if (error) {
    box.innerHTML = '<div class="error">Xəta: ' + error.message + "</div>";
    return;
  }

  const latestByVehicle = {};

  (data || []).forEach(function (ord) {
    if (!ord.vehicle_id) return;
    if (!latestByVehicle[ord.vehicle_id]) {
      latestByVehicle[ord.vehicle_id] = ord;
    }
  });

  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const soonStr = soon.toISOString().slice(0, 10);

  const dueList = Object.values(latestByVehicle).filter(function (ord) {
    const dateDue = ord.next_service_date && ord.next_service_date <= soonStr;

    const kmDue =
      ord.next_service_km &&
      ord.vehicles &&
      ord.vehicles.last_mileage >= ord.next_service_km - 1000;

    return dateDue || kmDue;
  });

  if (dueList.length === 0) {
    box.innerHTML = '<div class="small">Yaxınlaşan xatırlatma yoxdur.</div>';
    return;
  }

  remindersCache = {};
  box.innerHTML = "";

  dueList.forEach(function (ord) {
    remindersCache[ord.id] = ord;

    const vehicleText = ord.vehicles
      ? ord.vehicles.brand + " " + ord.vehicles.model + " (" + (ord.vehicles.plate_number || "-") + ")"
      : "-";

    const card = document.createElement("div");
    card.className = "item";

    card.innerHTML =
      '<div class="name">' + (ord.customers ? ord.customers.full_name : "-") + "</div>" +
      '<div class="small">' + vehicleText + "</div>" +
      '<div class="small">Son km: ' + (ord.vehicles ? ord.vehicles.last_mileage : "-") + "</div>" +
      '<div class="small">Növbəti servis: ' + (ord.next_service_km || "-") + " km / " + (ord.next_service_date || "-") + "</div>" +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn btn-green" onclick="sendReminder(\'' + ord.id + '\')">Xatırlatma göndər</button>' +
      "</div>";

    box.appendChild(card);
  });
}

function sendReminder(id) {
  const ord = remindersCache[id];
  if (!ord) return;

  const phone = (ord.customers && (ord.customers.whatsapp_phone || ord.customers.phone)) || "";
  const clean = phone.replace(/\D/g, "");

  if (!clean) {
    alert("Müştərinin WhatsApp nömrəsi yoxdur");
    return;
  }

  const name = ord.customers ? ord.customers.full_name : "";
  const vehicle = ord.vehicles ? ord.vehicles.brand + " " + ord.vehicles.model : "Avtomobiliniz";

  const text =
    "Salam " + name + ", " + vehicle +
    " avtomobiliniz üçün yağ dəyişmə vaxtı yaxınlaşır. Son km: " +
    (ord.vehicles ? ord.vehicles.last_mileage : "-") +
    ". Tövsiyə olunan növbəti yağ dəyişimi: " + (ord.next_service_km || "-") +
    " km və ya " + (ord.next_service_date || "-") +
    ". Növbə üçün cavab yazın.";

  const url = "https://wa.me/" + clean + "?text=" + encodeURIComponent(text);
  window.open(url, "_blank");
}

/* ---------- Müştərilər ---------- */

async function loadCustomers() {
  const box = document.getElementById("customers");
  box.innerHTML = '<div class="small">Yüklənir...</div>';

  const { data, error } = await db
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    box.innerHTML = '<div class="error">Xəta: ' + error.message + "</div>";
    return;
  }

  if (!data || data.length === 0) {
    box.innerHTML = '<div class="small">Hələ müştəri yoxdur.</div>';
    return;
  }

  box.innerHTML = "";

  data.forEach(function (customer) {
    const card = document.createElement("div");
    card.className = "item";

    card.innerHTML =
      '<div class="name">' + customer.full_name + "</div>" +
      '<div class="small">Telefon: ' + (customer.phone || "-") + "</div>" +
      '<div class="small">WhatsApp: ' + (customer.whatsapp_phone || "-") + "</div>" +
      (customer.note ? '<div class="small">' + customer.note + "</div>" : "");

    box.appendChild(card);
  });
}

function toggleCustomerForm() {
  document.getElementById("customerForm").classList.toggle("hidden");
}

async function addCustomer(event) {
  event.preventDefault();

  const name = document.getElementById("c_name").value.trim();
  const phone = document.getElementById("c_phone").value.trim();
  const whatsapp = document.getElementById("c_whatsapp").value.trim();
  const note = document.getElementById("c_note").value.trim();

  if (!name) {
    alert("Ad Soyad daxil edin");
    return;
  }

  const { error } = await db.from("customers").insert([
    {
      full_name: name,
      phone: phone || null,
      whatsapp_phone: whatsapp || null,
      note: note || null,
    },
  ]);

  if (error) {
    alert("Xəta: " + error.message);
    return;
  }

  document.getElementById("customerForm").reset();
  document.getElementById("customerForm").classList.add("hidden");

  loadCustomers();
  loadCustomerOptions();
  loadDashboard();
}

/* ---------- Avtomobillər ---------- */

async function loadVehicles() {
  const box = document.getElementById("vehicles");
  box.innerHTML = '<div class="small">Yüklənir...</div>';

  const { data, error } = await db
    .from("vehicles")
    .select("*, customers(full_name)")
    .order("created_at", { ascending: false });

  if (error) {
    box.innerHTML = '<div class="error">Xəta: ' + error.message + "</div>";
    return;
  }

  if (!data || data.length === 0) {
    box.innerHTML = '<div class="small">Hələ avtomobil yoxdur.</div>';
    return;
  }

  box.innerHTML = "";

  data.forEach(function (v) {
    const card = document.createElement("div");
    card.className = "item";

    card.innerHTML =
      '<div class="name">' + (v.brand || "") + " " + (v.model || "") + "</div>" +
      '<div class="small">Nömrə: ' + (v.plate_number || "-") + "</div>" +
      '<div class="small">Müştəri: ' + ((v.customers && v.customers.full_name) || "-") + "</div>" +
      '<div class="small">Son km: ' + (v.last_mileage || "-") + "</div>";

    box.appendChild(card);
  });
}

async function loadCustomerOptions() {
  const select = document.getElementById("v_customer");

  const { data, error } = await db
    .from("customers")
    .select("id, full_name")
    .order("full_name");

  if (error) return;

  select.innerHTML = "";

  (data || []).forEach(function (c) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.full_name;
    select.appendChild(opt);
  });
}

function toggleVehicleForm() {
  loadCustomerOptions();
  document.getElementById("vehicleForm").classList.toggle("hidden");
}

async function addVehicle(event) {
  event.preventDefault();

  const customer_id = document.getElementById("v_customer").value;
  const brand = document.getElementById("v_brand").value.trim();
  const model = document.getElementById("v_model").value.trim();
  const year = parseInt(document.getElementById("v_year").value, 10) || null;
  const plate = document.getElementById("v_plate").value.trim();
  const mileage = parseInt(document.getElementById("v_mileage").value, 10) || null;

  if (!customer_id) {
    alert("Müştəri seçin");
    return;
  }

  if (!brand) {
    alert("Marka daxil edin");
    return;
  }

  const { error } = await db.from("vehicles").insert([
    {
      customer_id: customer_id,
      brand: brand,
      model: model || null,
      year: year,
      plate_number: plate || null,
      last_mileage: mileage,
    },
  ]);

  if (error) {
    alert("Xəta: " + error.message);
    return;
  }

  document.getElementById("vehicleForm").reset();
  document.getElementById("vehicleForm").classList.add("hidden");

  loadVehicles();
  loadDashboard();
}

/* ---------- Sifarişlər ---------- */

const STATUS_LABELS = {
  pending: "Növbədə",
  in_progress: "İşdədir",
  ready: "Hazırdır",
  done: "Bağlandı",
};

let ordersCache = {};

async function loadOrderCustomers() {
  const select = document.getElementById("o_customer");

  const { data, error } = await db
    .from("customers")
    .select("id, full_name")
    .order("full_name");

  if (error) return;

  select.innerHTML = "";

  (data || []).forEach(function (c) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.full_name;
    select.appendChild(opt);
  });

  loadOrderVehicles();
}

async function loadOrderVehicles() {
  const customerId = document.getElementById("o_customer").value;
  const select = document.getElementById("o_vehicle");

  select.innerHTML = "";

  if (!customerId) return;

  const { data, error } = await db
    .from("vehicles")
    .select("id, brand, model, plate_number, last_mileage")
    .eq("customer_id", customerId)
    .order("created_at");

  if (error) return;

  (data || []).forEach(function (v) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent =
      (v.brand || "") + " " + (v.model || "") + " (" + (v.plate_number || "-") + ")";
    opt.dataset.mileage = v.last_mileage || "";
    select.appendChild(opt);
  });

  prefillMileage();
}

function prefillMileage() {
  const select = document.getElementById("o_vehicle");
  const opt = select.selectedOptions[0];

  if (opt && opt.dataset.mileage) {
    document.getElementById("o_mileage").value = opt.dataset.mileage;
  }
}

function toggleOrderForm() {
  const form = document.getElementById("orderForm");
  form.classList.toggle("hidden");

  if (!form.classList.contains("hidden")) {
    loadOrderCustomers();
  }
}

async function addOrder(event) {
  event.preventDefault();

  const customer_id = document.getElementById("o_customer").value;
  const vehicle_id = document.getElementById("o_vehicle").value;
  const mileage = parseInt(document.getElementById("o_mileage").value, 10) || 0;
  const pkg = document.getElementById("o_package").value;
  const amount = parseFloat(document.getElementById("o_amount").value) || 0;
  const note = document.getElementById("o_note").value.trim();

  if (!customer_id || !vehicle_id) {
    alert("Müştəri və avtomobil seçin");
    return;
  }

  if (!mileage) {
    alert("Son km daxil edin");
    return;
  }

  const next_service_km = mileage + DEFAULT_INTERVAL_KM;

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + DEFAULT_INTERVAL_DAYS);
  const next_service_date = nextDate.toISOString().slice(0, 10);

  const order_number = "S-" + String(Date.now()).slice(-6);

  const { error } = await db.from("service_orders").insert([
    {
      customer_id: customer_id,
      vehicle_id: vehicle_id,
      order_number: order_number,
      status: "pending",
      mileage: mileage,
      package: pkg,
      total_amount: amount,
      payment_status: "unpaid",
      note: note || null,
      next_service_km: next_service_km,
      next_service_date: next_service_date,
      started_at: new Date().toISOString(),
    },
  ]);

  if (error) {
    alert("Xəta: " + error.message);
    return;
  }

  await db
    .from("vehicles")
    .update({ last_mileage: mileage })
    .eq("id", vehicle_id);

  document.getElementById("orderForm").reset();
  document.getElementById("orderForm").classList.add("hidden");

  loadOrderCustomers();
  loadOrders();
  loadDashboard();

  alert("Sifariş yaradıldı: " + order_number);
}

async function loadOrders() {
  const box = document.getElementById("orders");
  box.innerHTML = '<div class="small">Yüklənir...</div>';

  const { data, error } = await db
    .from("service_orders")
    .select("*, customers(full_name, phone, whatsapp_phone), vehicles(brand, model, plate_number)")
    .order("created_at", { ascending: false });

  if (error) {
    box.innerHTML = '<div class="error">Xəta: ' + error.message + "</div>";
    return;
  }

  if (!data || data.length === 0) {
    box.innerHTML = '<div class="small">Hələ sifariş yoxdur.</div>';
    return;
  }

  ordersCache = {};

  data.forEach(function (o) {
    ordersCache[o.id] = o;
  });

  box.innerHTML = "";

  data.forEach(function (o) {
    const card = document.createElement("div");
    card.className = "item";

    const vehicleText = o.vehicles
      ? o.vehicles.brand + " " + o.vehicles.model + " (" + (o.vehicles.plate_number || "-") + ")"
      : "-";

    card.innerHTML =
      '<div class="name">' + o.order_number + " — " + (o.customers ? o.customers.full_name : "-") + "</div>" +
      '<div class="small">' + vehicleText + "</div>" +
      '<div class="small">Km: ' + (o.mileage || "-") + " | Paket: " + (o.package || "-") + "</div>" +
      '<div class="small">Məbləğ: ' + (o.total_amount || 0) + " AZN | Ödəniş: " + (o.payment_status === "paid" ? "Ödənilib" : "Ödənilməyib") + "</div>" +
      '<div class="small">Növbəti servis: ' + (o.next_service_km || "-") + " km / " + (o.next_service_date || "-") + "</div>" +
      '<div class="row" style="margin-top:8px">' +
      '<select class="status-select" onchange="updateOrderStatus(\'' + o.id + '\', this.value)">' +
      Object.keys(STATUS_LABELS)
        .map(function (key) {
          return '<option value="' + key + '"' + (o.status === key ? " selected" : "") + ">" + STATUS_LABELS[key] + "</option>";
        })
        .join("") +
      "</select>" +
      '<button class="btn btn-green" onclick="sendWhatsApp(\'' + o.id + '\')">WhatsApp</button>' +
      "</div>";

    box.appendChild(card);
  });
}

async function updateOrderStatus(id, status) {
  const update = { status: status };

  if (status === "ready" || status === "done") {
    update.finished_at = new Date().toISOString();
  }

  if (status === "done") {
    update.payment_status = "paid";
  }

  const { error } = await db
    .from("service_orders")
    .update(update)
    .eq("id", id);

  if (error) {
    alert("Xəta: " + error.message);
    return;
  }

  loadOrders();
  loadDashboard();
}

function sendWhatsApp(id) {
  const o = ordersCache[id];
  if (!o) return;

  const phone = (o.customers && (o.customers.whatsapp_phone || o.customers.phone)) || "";
  const clean = phone.replace(/\D/g, "");

  if (!clean) {
    alert("Müştərinin WhatsApp nömrəsi yoxdur");
    return;
  }

  const name = o.customers ? o.customers.full_name : "";
  const vehicle = o.vehicles ? o.vehicles.brand + " " + o.vehicles.model : "Avtomobiliniz";

  let text = "";

  if (o.status === "pending") {
    text =
      "Salam " + name + ", " + vehicle +
      " avtomobiliniz üçün müraciətiniz qəbul edildi. Status: Növbədə.";
  } else if (o.status === "in_progress") {
    text =
      "Salam " + name + ", " + vehicle +
      " avtomobiliniz hazırda işdədir. Hazır olduqda sizə məlumat verəcəyik.";
  } else if (o.status === "ready") {
    text =
      "Salam " + name + ", " + vehicle +
      " avtomobiliniz hazırdır. Yekun məbləğ: " + (o.total_amount || 0) +
      " AZN. Servisimizə gələ bilərsiniz.";
  } else {
    text =
      "Salam " + name + ", " + vehicle +
      " avtomobiliniz üçün yağ dəyişimi tamamlandı. Son km: " + (o.mileage || "-") +
      ". Növbəti yağ dəyişimi: " + (o.next_service_km || "-") + " km və ya " +
      (o.next_service_date || "-") + ". Sualınız olarsa, yazın.";
  }

  const url = "https://wa.me/" + clean + "?text=" + encodeURIComponent(text);
  window.open(url, "_blank");
}

/* ---------- Başlanğıc ---------- */

initAuth();