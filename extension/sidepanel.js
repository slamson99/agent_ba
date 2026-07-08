// DOM Elements
const salesInput = document.getElementById('sales-search-input');
const productsInput = document.getElementById('products-search-input');
const clearSalesBtn = document.getElementById('clear-sales-btn');
const clearProductsBtn = document.getElementById('clear-products-btn');

const loader = document.getElementById('loader');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');
const emptyState = document.getElementById('empty-state');
const resultsPanel = document.getElementById('results-panel');
const searchTriageBadge = document.getElementById('search-triage-badge');
const triageType = document.getElementById('triage-type');

// Tab Switching DOM Elements
const tabSalesBtn = document.getElementById('tab-sales-btn');
const tabProductsBtn = document.getElementById('tab-products-btn');
const salesEnv = document.getElementById('sales-env');
const productsEnv = document.getElementById('products-env');

const salesList = document.getElementById('sales-list');
const productsList = document.getElementById('products-list');

// Settings DOM Elements
const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const backendUrlInput = document.getElementById('backend-url');
const saveSettingsBtn = document.getElementById('save-settings-btn');

const filterSortSelect = document.getElementById('filter-sort');

// Constants & State Configuration
const DEFAULT_BACKEND_URL = 'https://agent-ba.vercel.app';
let backendUrl = DEFAULT_BACKEND_URL;

let activeTab = 'sales'; // 'sales' or 'products'
let currentResults = null; // Flat array returned by backend
let searchDebounceTimeout = null;

// Initialize Settings
document.addEventListener('DOMContentLoaded', () => {
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['backendUrl'], (result) => {
      if (result.backendUrl) {
        backendUrl = result.backendUrl;
      }
      backendUrlInput.value = backendUrl;
    });
  } else {
    backendUrlInput.value = backendUrl;
  }
  // Initialize sorting dropdown to default newest first
  if (filterSortSelect) {
    filterSortSelect.value = 'date-desc';
  }
});

// Dismiss Auto-suggest dropdown when clicking outside
document.addEventListener('click', (e) => {
  const suggestList = document.getElementById('search-suggest-list');
  if (suggestList && !salesInput.contains(e.target) && !suggestList.contains(e.target)) {
    hideSuggestions();
  }
});

// Tab Switching Logic
function switchTab(tab) {
  if (activeTab === tab) return;
  activeTab = tab;

  // Clear states
  clearTimeout(searchDebounceTimeout);
  currentResults = null;

  // Clear inputs
  salesInput.value = '';
  productsInput.value = '';
  clearSalesBtn.classList.add('hidden');
  clearProductsBtn.classList.add('hidden');

  hideSuggestions();
  resetUI();

  if (activeTab === 'sales') {
    // Style tabs
    tabSalesBtn.className = "flex-1 py-3 text-center text-xs font-bold border-b-2 border-sky-500 text-sky-600 focus:outline-none transition-all flex items-center justify-center space-x-1";
    tabProductsBtn.className = "flex-1 py-3 text-center text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 focus:outline-none transition-all flex items-center justify-center space-x-1";
    
    // Toggle environments
    salesEnv.classList.remove('hidden');
    productsEnv.classList.add('hidden');

    salesList.classList.remove('hidden');
    productsList.classList.add('hidden');
  } else {
    // Style tabs
    tabProductsBtn.className = "flex-1 py-3 text-center text-xs font-bold border-b-2 border-sky-500 text-sky-600 focus:outline-none transition-all flex items-center justify-center space-x-1";
    tabSalesBtn.className = "flex-1 py-3 text-center text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 focus:outline-none transition-all flex items-center justify-center space-x-1";
    
    // Toggle environments
    productsEnv.classList.remove('hidden');
    salesEnv.classList.add('hidden');

    productsList.classList.remove('hidden');
    salesList.classList.add('hidden');
  }
}

tabSalesBtn.addEventListener('click', () => switchTab('sales'));
tabProductsBtn.addEventListener('click', () => switchTab('products'));

// Toggle Settings Panel
toggleSettingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

// Save Settings
saveSettingsBtn.addEventListener('click', () => {
  let url = backendUrlInput.value.trim();
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  backendUrl = url;
  
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ backendUrl: url }, () => {
      showStatusAlert('Settings Saved Successfully', 'success');
      settingsPanel.classList.add('hidden');
    });
  } else {
    showStatusAlert('Saved (Memory Only)', 'warning');
    settingsPanel.classList.add('hidden');
  }
});

// Customer Sales Input Trigger
salesInput.addEventListener('input', () => {
  const query = salesInput.value.trim();
  
  if (query.length > 0) {
    clearSalesBtn.classList.remove('hidden');
  } else {
    clearSalesBtn.classList.add('hidden');
    resetUI();
    hideSuggestions();
    return;
  }

  // Auto-Suggest on Customer Name strings
  if (query.length > 2) {
    showSuggestions(query);
  } else {
    hideSuggestions();
  }

  if (query.length > 2) {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      executeSearch(query);
    }, 400);
  }
});

salesInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const query = salesInput.value.trim();
    if (query.length > 0) {
      clearTimeout(searchDebounceTimeout);
      hideSuggestions();
      executeSearch(query);
    }
  }
});

clearSalesBtn.addEventListener('click', () => {
  salesInput.value = '';
  clearSalesBtn.classList.add('hidden');
  resetUI();
  hideSuggestions();
});

// Products Input Trigger
productsInput.addEventListener('input', () => {
  const query = productsInput.value.trim();
  
  if (query.length > 0) {
    clearProductsBtn.classList.remove('hidden');
  } else {
    clearProductsBtn.classList.add('hidden');
    resetUI();
    return;
  }

  if (query.length > 2) {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      executeSearch(query);
    }, 400);
  }
});

productsInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const query = productsInput.value.trim();
    if (query.length > 0) {
      clearTimeout(searchDebounceTimeout);
      executeSearch(query);
    }
  }
});

clearProductsBtn.addEventListener('click', () => {
  productsInput.value = '';
  clearProductsBtn.classList.add('hidden');
  resetUI();
});

// Auto-Suggest List Generation
function getOrCreateSuggestList() {
  let suggestList = document.getElementById('search-suggest-list');
  if (!suggestList) {
    suggestList = document.createElement('div');
    suggestList.id = 'search-suggest-list';
    suggestList.className = 'absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto divide-y divide-slate-100 hidden text-xs';
    salesInput.parentNode.appendChild(suggestList);
  }
  return suggestList;
}

// Refined Auto-Suggest Logic: Focus strictly on Customer Name strings
function showSuggestions(query) {
  const suggestList = getOrCreateSuggestList();
  suggestList.innerHTML = '';
  
  if (!Array.isArray(currentResults) || activeTab !== 'sales') {
    suggestList.classList.add('hidden');
    return;
  }

  const qLower = query.toLowerCase();
  const matchedSales = currentResults.filter(s => 
    (s.Customer || '').toLowerCase().includes(qLower)
  );

  const uniqueCustomers = [];
  const uniqueMatchedSales = [];
  
  matchedSales.forEach(s => {
    if (s.Customer && !uniqueCustomers.includes(s.Customer.toLowerCase())) {
      uniqueCustomers.push(s.Customer.toLowerCase());
      uniqueMatchedSales.push(s);
    }
  });

  if (uniqueMatchedSales.length === 0) {
    suggestList.classList.add('hidden');
    return;
  }

  // Render unique customer suggestions (up to 5)
  uniqueMatchedSales.slice(0, 5).forEach(s => {
    const row = document.createElement('div');
    row.className = 'px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors';
    row.innerHTML = `
      <div class="font-bold text-slate-700">👤 ${escapeHTML(s.Customer)}</div>
      <div class="text-[10px] text-slate-400 font-semibold">Customer Match</div>
    `;
    row.addEventListener('click', () => {
      salesInput.value = s.Customer;
      hideSuggestions();
      executeSearch(s.Customer);
    });
    suggestList.appendChild(row);
  });

  suggestList.classList.remove('hidden');
}

function hideSuggestions() {
  const suggestList = document.getElementById('search-suggest-list');
  if (suggestList) {
    suggestList.classList.add('hidden');
  }
}

// Reset visual elements
function resetUI() {
  loader.classList.add('hidden');
  errorBanner.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  searchTriageBadge.classList.add('hidden');
  emptyState.classList.remove('hidden');
  
  salesList.innerHTML = '';
  productsList.innerHTML = '';
  
  currentResults = null;
}

// Perform API global search call with scope routing and flat array parsing
async function executeSearch(query) {
  if (!query) return;

  loader.classList.remove('hidden');
  errorBanner.classList.add('hidden'); // Clear historical 429 notifications and error banners cleanly
  emptyState.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  searchTriageBadge.classList.add('hidden');

  // Default sorting dropdown based on active tab
  if (filterSortSelect) {
    filterSortSelect.value = activeTab === 'sales' ? 'date-desc' : 'default';
  }

  const sanitizedUrl = backendUrl.replace(/\/$/, '');
  const searchUrl = `${sanitizedUrl}/api/global-search?query=${encodeURIComponent(query)}&scope=${activeTab}`;

  try {
    const response = await fetch(searchUrl);
    
    if (response.status === 404) {
      throw new Error("404 Error: Please check that your saved Backend URL includes the right domain root, and your backend functions are fully deployed.");
    }
    
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server responded with status ${response.status}`);
    }

    const data = await response.json();
    currentResults = data; // Raw flat array payload (sales or products)
    
    // Strict Type Checking
    if (!Array.isArray(currentResults)) {
      currentResults = [];
    }

    applyFilterAndRender();

  } catch (error) {
    console.error("Search failed:", error);
    errorMessage.textContent = error.message || "Unable to reach server. Check backend URL configuration.";
    errorBanner.classList.remove('hidden');
  } finally {
    // Loader spinner guaranteed hide inside finally block
    loader.classList.add('hidden');
  }
}

// Filter & Sort Change listener
if (filterSortSelect) {
  filterSortSelect.addEventListener('change', () => {
    if (!currentResults) return;
    applyFilterAndRender();
  });
}

// Combine and sort active scope's flat array datasets
function getCombinedSortedItems() {
  if (!Array.isArray(currentResults)) return [];
  
  const sortVal = filterSortSelect ? filterSortSelect.value : 'date-desc';

  if (activeTab === 'sales') {
    const filteredSales = currentResults.filter(s => {
      const status = (s.Status || '').toUpperCase();
      return status !== 'VOID' && status !== 'VOIDED';
    });

    const combinedItems = filteredSales.map(s => ({ type: 'sale', data: s }));

    // Sort Sales
    if (sortVal === 'default' || sortVal === 'date-desc') {
      combinedItems.sort((a, b) => {
        const da = a.data.OrderDate ? new Date(a.data.OrderDate) : new Date(0);
        const db = b.data.OrderDate ? new Date(b.data.OrderDate) : new Date(0);
        return db - da;
      });
    } else if (sortVal === 'date-asc') {
      combinedItems.sort((a, b) => {
        const da = a.data.OrderDate ? new Date(a.data.OrderDate) : new Date(0);
        const db = b.data.OrderDate ? new Date(b.data.OrderDate) : new Date(0);
        return da - db;
      });
    } else if (sortVal === 'name-az') {
      combinedItems.sort((a, b) => (a.data.Customer || '').localeCompare(b.data.Customer || ''));
    } else if (sortVal === 'name-za') {
      combinedItems.sort((a, b) => (b.data.Customer || '').localeCompare(a.data.Customer || ''));
    }
    return combinedItems;

  } else {
    // products (flat products array)
    const combinedItems = currentResults.map(p => ({ type: 'product', data: p }));

    // Sort Products
    if (sortVal === 'default' || sortVal === 'name-az') {
      combinedItems.sort((a, b) => (a.data.SKU || '').localeCompare(b.data.SKU || ''));
    } else if (sortVal === 'name-za') {
      combinedItems.sort((a, b) => (b.data.SKU || '').localeCompare(a.data.SKU || ''));
    }
    return combinedItems;
  }
}

// Directly renders the entire returned array to the UI, removing client-side pagination
function applyFilterAndRender() {
  const combinedItems = getCombinedSortedItems();
  const totalItems = combinedItems.length;

  if (totalItems === 0) {
    resetUI();
    return;
  }

  emptyState.classList.add('hidden');

  triageType.textContent = activeTab === 'sales' ? 'Customer Sales' : 'Product Inventory';
  searchTriageBadge.classList.remove('hidden');

  // Clear specific active container lists
  salesList.innerHTML = '';
  productsList.innerHTML = '';

  combinedItems.forEach(item => {
    if (item.type === 'sale') {
      const card = createSaleCard(item.data);
      if (card) salesList.appendChild(card);
    } else {
      const card = createProductCard(item.data);
      if (card) productsList.appendChild(card);
    }
  });

  resultsPanel.classList.remove('hidden');
}

// Generate Flat Product Card element (accordion logic removed)
function createProductCard(product) {
  if (!product) return null;

  const sku = product.SKU || 'N/A';
  const name = product.Name || 'Unnamed Product';
  const brand = product.Brand || 'N/A';
  const tax = product.SaleTaxRule || 'N/A';
  const availStock = product.AvailableStock !== undefined ? product.AvailableStock : 0;
  const onOrder = product.OnOrder !== undefined ? product.OnOrder : 0;
  const wsPrice = (product.PriceTier1 || 0).toFixed(2);
  const rrpPrice = (product.PriceTier5 || 0).toFixed(2);

  const card = document.createElement('div');
  card.className = 'bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:border-slate-300 transition-colors flex flex-col text-xs space-y-1.5';

  card.innerHTML = `
    <div class="flex justify-between items-start">
      <h3 class="font-bold text-slate-800 text-[12px] break-all leading-normal">
        <span class="text-sky-600">📦 ${escapeHTML(sku)}</span> - ${escapeHTML(name)}
      </h3>
    </div>
    <p class="text-slate-400 font-medium text-[9px]">Brand: ${escapeHTML(brand)} | Tax: ${escapeHTML(tax)}</p>
    
    <div class="grid grid-cols-2 gap-2 pt-1">
      <div class="bg-slate-50 rounded p-2 border border-slate-100 text-[10px]">
        <div class="text-slate-500 font-semibold text-[8px] uppercase tracking-wider">Inventory Status</div>
        <div class="font-bold text-slate-700 mt-1">Available: <span class="text-emerald-700">${availStock}</span></div>
        <div class="text-[9px] text-slate-400 mt-0.5">On Order: ${onOrder}</div>
      </div>
      <div class="bg-slate-50 rounded p-2 border border-slate-100 text-[10px] text-right">
        <div class="text-slate-500 text-left font-semibold text-[8px] uppercase tracking-wider">Commercial Meta</div>
        <div class="font-bold text-slate-700 mt-1">WS: $${wsPrice}</div>
        <div class="text-[9px] text-slate-400 mt-0.5">RRP (GST incl): $${rrpPrice}</div>
      </div>
    </div>
  `;

  return card;
}

// Tracking links parsing helper (extracts urls and reference numbers cleanly)
function formatTrackingNumbers(trackingStr) {
  if (!trackingStr || trackingStr === 'N/A') return 'N/A';
  
  const parts = trackingStr.split(',');
  let trackingCode = '';
  let trackingUrl = '';
  
  for (let part of parts) {
    part = part.trim();
    if (part.startsWith('http://') || part.startsWith('https://')) {
      trackingUrl = part;
    } else if (part) {
      trackingCode = part;
    }
  }
  
  if (trackingCode && trackingUrl) {
    return `${escapeHTML(trackingCode)} <a href="${escapeHTML(trackingUrl)}" target="_blank" class="text-blue-600 underline ml-1 font-medium">Track Order ↗</a>`;
  }
  if (trackingUrl) {
    return `<a href="${escapeHTML(trackingUrl)}" target="_blank" class="text-blue-600 underline font-medium">Track Order ↗</a>`;
  }
  return escapeHTML(trackingStr);
}

// Generate Sale Card element (Renders collapsed by default, zero copy/download buttons, absolute check safeguards)
// Uses strict tilde-separated single-page-app hashes for internal routing
function createSaleCard(sale) {
  if (!sale) return null;

  const saleId = sale.SaleID || sale.ID || '';
  const orderNumber = sale.OrderNumber || 'Unassigned';
  const status = sale.Status || 'Draft';
  const orderDate = sale.OrderDate || 'N/A';
  
  const invoiceNumber = sale.InvoiceNumber || 'N/A';
  const customerReference = sale.CustomerReference || 'N/A';
  
  const customer = sale.Customer || 'Unknown Customer';
  const email = sale.Email || 'N/A';
  const salesRep = sale.SalesRepresentative || 'N/A';
  const discount = sale.Discount !== undefined ? sale.Discount : 0;
  const attribute6 = sale.AreaCode || 'N/A';
  
  const fulfilmentStatus = sale.Status || 'N/A';
  const combinedTracking = sale.TrackingNumber || 'N/A';
  const invoiceAmount = sale.InvoiceAmount !== undefined ? sale.InvoiceAmount : 0;
  const shippingNotes = sale.ShippingNotes || 'N/A';

  // Invoice accounting fields
  const invoiceDueDate = sale.InvoiceDueDate || 'N/A';
  const invoiceStatus = sale.InvoiceStatus || 'UNPAID';

  const card = document.createElement('div');
  card.className = 'bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:border-slate-300 transition-colors flex flex-col text-xs';

  // Nest product list inside card, sorted alphabetically by SKU
  let linesHtml = '';
  if (sale.OrderLines && sale.OrderLines.length > 0) {
    const sortedLines = [...sale.OrderLines].sort((a, b) => 
      (a.SKU || '').toLowerCase().localeCompare((b.SKU || '').toLowerCase())
    );

    linesHtml = `
      <div class="border border-slate-100 rounded p-2 space-y-1 text-[10px] bg-white mt-2.5">
        <div class="font-semibold text-slate-700 pb-0.5 border-b border-slate-100 uppercase tracking-wider text-[8px]">ORDERED ITEMS</div>
        <div class="divide-y divide-slate-100">
          ${sortedLines.map(line => {
            if (!line) return '';
            const sku = line.SKU || '';
            const name = line.Name || '';
            const quantity = line.Quantity || 0;

            return `
              <div class="py-2 flex justify-between items-center text-[10px]">
                <div class="flex-grow pr-3 flex flex-col">
                  <div class="font-bold text-slate-800">${escapeHTML(sku)}</div>
                  <div class="text-[11px] text-slate-500 leading-tight mt-0.5 whitespace-normal break-words">${escapeHTML(name)}</div>
                </div>
                <div class="text-right shrink-0">
                  <span class="font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">Qty: ${quantity}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <!-- Collapsible Header Summary Row with deep portal links -->
    <div class="card-header flex justify-between items-center cursor-pointer select-none">
      <div class="flex-grow pr-2">
        <h3 class="font-bold text-slate-800 text-[13px] flex items-center space-x-1.5">
          <a href="https://inventory.dearsystems.com/Sale#${escapeHTML(saleId)}~${escapeHTML(saleId)}~tabOrder" target="_blank" class="hover:underline text-slate-800 font-bold transition-colors">📋 ${escapeHTML(orderNumber)} ↗</a>
          <a href="https://inventory.dearsystems.com/Customer#${escapeHTML(sale.CustomerID || '')}" target="_blank" class="text-[10px] text-slate-400 font-normal hover:underline hover:text-sky-600 transition-colors">| ${escapeHTML(customer)} ↗</a>
        </h3>
        <p class="text-slate-400 font-medium text-[9px] mt-0.5">${escapeHTML(orderDate)}</p>
      </div>
      <div class="flex items-center space-x-2">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusBadgeClass(status)}">
          ${escapeHTML(status)}
        </span>
        <span class="toggle-icon text-slate-400 font-bold text-xs">▼</span>
      </div>
    </div>

    <!-- Collapsible Details Panel (Hidden by default) -->
    <div class="card-details hidden space-y-2.5 border-t border-slate-100 pt-2.5 mt-2.5">
      <div class="bg-slate-50 rounded border border-slate-100 p-2 space-y-1 text-[10px]">
        <div class="flex justify-between">
          <span class="text-slate-500">Invoice Number:</span> 
          <span class="font-bold text-slate-700">
            <a href="https://inventory.dearsystems.com/Sale#${escapeHTML(saleId)}~${escapeHTML(saleId)}~tabInvoice" target="_blank" class="hover:underline text-sky-600 font-bold hover:text-sky-800 transition-colors">${escapeHTML(invoiceNumber)} ↗</a>
          </span>
        </div>
        <div class="flex justify-between"><span class="text-slate-500">Customer Ref:</span> <span class="font-bold text-slate-700">${escapeHTML(customerReference)}</span></div>
      </div>

      <div class="border border-slate-100 rounded p-2 space-y-1 text-[10px] bg-sky-50/30">
        <div class="font-semibold text-slate-700 pb-0.5 border-b border-slate-100 uppercase tracking-wider text-[8px]">Customer Profile</div>
        <div class="flex justify-between"><span class="text-slate-500">Email:</span> <span class="font-medium text-slate-700">${escapeHTML(email)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Sales Rep:</span> <span class="font-medium text-slate-700">${escapeHTML(salesRep)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Discount %:</span> <span class="font-medium text-slate-700">${discount}%</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Area Code:</span> <span class="font-medium text-slate-700">${escapeHTML(attribute6)}</span></div>
      </div>

      <!-- Logistics & Billing Panel -->
      <div class="border border-slate-100 rounded p-2 space-y-1 text-[10px] bg-slate-50/50">
        <div class="font-semibold text-slate-700 pb-0.5 border-b border-slate-100 uppercase tracking-wider text-[8px] flex justify-between items-center">
          <span>Logistics & Billing</span>
          <span class="font-bold text-[9px]">${invoiceStatus === 'PAID' ? '🟩 PAID' : '🟨 UNPAID / PARTIALLY PAID'}</span>
        </div>
        <div class="flex justify-between"><span class="text-slate-500">Invoice Due Date:</span> <span class="font-semibold text-slate-700">${escapeHTML(invoiceDueDate)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Fulfillment Status:</span> <span class="font-semibold text-slate-700">${escapeHTML(fulfilmentStatus)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Tracking Numbers:</span> <span class="font-semibold text-sky-700 select-all">${formatTrackingNumbers(combinedTracking)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Invoice Amount:</span> <span class="font-bold text-slate-800">$${invoiceAmount.toFixed(2)}</span></div>
        <div class="pt-1 border-t border-slate-100 mt-1"><span class="text-slate-500 block pb-0.5">Shipping Notes:</span> <span class="text-slate-600 block italic leading-normal">${escapeHTML(shippingNotes)}</span></div>
      </div>

      <!-- Embedded Order Lines -->
      ${linesHtml}
    </div>
  `;

  // Click handler to toggle collapsed details
  const header = card.querySelector('.card-header');
  const details = card.querySelector('.card-details');
  const toggleIcon = card.querySelector('.toggle-icon');
  header.addEventListener('click', () => {
    const isHidden = details.classList.toggle('hidden');
    toggleIcon.textContent = isHidden ? '▼' : '▲';
  });

  return card;
}

// Download PDF blob from Backend (Retained for system utility, not mapped to card actions)
async function downloadDocument(button, saleId, type) {
  if (!saleId) {
    showStatusAlert("Missing Sale ID", "danger");
    return;
  }

  const originalContent = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span>⏳ Downloading...</span>';

  const sanitizedUrl = backendUrl.replace(/\/$/, '');
  const downloadUrl = `${sanitizedUrl}/api/download-doc?saleId=${encodeURIComponent(saleId)}`;

  try {
    const response = await fetch(downloadUrl);

    if (response.status === 404) {
      throw new Error("404 Error: Please check that your saved Backend URL includes the right domain root, and your backend functions are fully deployed.");
    }

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `Download failed: status ${response.status}`);
    }

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `Invoice_${saleId}.pdf`;
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);

    button.innerHTML = '<span>✅ Ready</span>';
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = originalContent;
    }, 2000);

  } catch (error) {
    console.error("Document download failed:", error);
    showStatusAlert(error.message || "Failed to retrieve PDF", "danger");
    button.disabled = false;
    button.innerHTML = originalContent;
  }
}

// CSS class helpers for badges
function getStatusBadgeClass(status) {
  const normStatus = status.toLowerCase();
  if (normStatus.includes('fulfill') || normStatus.includes('shipped') || normStatus.includes('complete')) {
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  }
  if (normStatus.includes('order') || normStatus.includes('invoice')) {
    return 'bg-sky-50 text-sky-700 border border-sky-200';
  }
  if (normStatus.includes('draft') || normStatus.includes('quote')) {
    return 'bg-slate-50 text-slate-600 border border-slate-200';
  }
  return 'bg-amber-50 text-amber-700 border border-amber-200';
}

// Alert banner utility when chrome storage/action fails
function showStatusAlert(msg, level) {
  const alertDiv = document.createElement('div');
  alertDiv.className = `fixed bottom-12 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full shadow-lg text-xs font-semibold z-50 transition-all transform scale-95 duration-200 ${
    level === 'success' ? 'bg-emerald-600 text-white' : 
    level === 'warning' ? 'bg-amber-500 text-slate-900' : 'bg-rose-600 text-white'
  }`;
  alertDiv.textContent = msg;
  document.body.appendChild(alertDiv);
  
  setTimeout(() => {
    alertDiv.classList.add('opacity-0', 'scale-90');
    setTimeout(() => alertDiv.remove(), 300);
  }, 2200);
}

// Helper to escape HTML special characters
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
