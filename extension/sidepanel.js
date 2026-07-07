// DOM Elements
const searchInput = document.getElementById('global-search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const loader = document.getElementById('loader');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');
const emptyState = document.getElementById('empty-state');
const resultsPanel = document.getElementById('results-panel');
const searchTriageBadge = document.getElementById('search-triage-badge');
const triageType = document.getElementById('triage-type');

// Pagination DOM Elements
const paginationControls = document.getElementById('pagination-controls');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const pageIndicator = document.getElementById('page-indicator');

// Settings DOM Elements
const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const backendUrlInput = document.getElementById('backend-url');
const saveSettingsBtn = document.getElementById('save-settings-btn');

const filterSortSelect = document.getElementById('filter-sort');

// Constants & State Configuration
const DEFAULT_BACKEND_URL = 'https://agent-ba.vercel.app';
let backendUrl = DEFAULT_BACKEND_URL;

let currentResults = null; // Full unified dataset cached in memory
const PAGE_SIZE = 10;      // Strictly 10 slots per page
let currentPage = 1;
let searchDebounceTimeout = null;

// Relevance matching scoring
function getRelevanceScore(name, query) {
  if (!name || !query) return 0;
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 50;
  return 0;
}

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
});

// Dismiss Auto-suggest dropdown when clicking outside
document.addEventListener('click', (e) => {
  const suggestList = document.getElementById('search-suggest-list');
  if (suggestList && !searchInput.contains(e.target) && !suggestList.contains(e.target)) {
    hideSuggestions();
  }
});

// Pagination Controls Handlers
if (prevPageBtn) {
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      applyFilterAndRender();
    }
  });
}
if (nextPageBtn) {
  nextPageBtn.addEventListener('click', () => {
    const combinedItems = getCombinedSortedItems();
    const totalPages = Math.ceil(combinedItems.length / PAGE_SIZE) || 1;
    if (currentPage < totalPages) {
      currentPage++;
      applyFilterAndRender();
    }
  });
}

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

// Search input trigger listener with debouncing
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  
  if (query.length > 0) {
    clearSearchBtn.classList.remove('hidden');
  } else {
    clearSearchBtn.classList.add('hidden');
    resetUI();
    hideSuggestions();
    return;
  }

  // 1. Lightweight suggestions overlay (in-memory)
  if (query.length > 2) {
    showSuggestions(query);
  } else {
    hideSuggestions();
  }

  // 2. Active Search Pipeline: Trigger execution debounced
  if (query.length > 2) {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      executeSearch(query);
    }, 400);
  }
});

// Clear search handler
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  resetUI();
  hideSuggestions();
});

// Instant Search on Enter key
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const query = searchInput.value.trim();
    if (query.length > 0) {
      clearTimeout(searchDebounceTimeout);
      hideSuggestions();
      executeSearch(query);
    }
  }
});

// Auto-Suggest List Generation
function getOrCreateSuggestList() {
  let suggestList = document.getElementById('search-suggest-list');
  if (!suggestList) {
    suggestList = document.createElement('div');
    suggestList.id = 'search-suggest-list';
    suggestList.className = 'absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto divide-y divide-slate-100 hidden text-xs';
    searchInput.parentNode.appendChild(suggestList);
  }
  return suggestList;
}

function showSuggestions(query) {
  const suggestList = getOrCreateSuggestList();
  suggestList.innerHTML = '';
  
  if (!currentResults) {
    suggestList.classList.add('hidden');
    return;
  }

  const qLower = query.toLowerCase();
  
  // Instantly filter local cached dataset case-insensitively
  const matchedSales = (currentResults.sales || []).filter(s => 
    (s.OrderNumber || '').toLowerCase().includes(qLower) ||
    (s.Customer || '').toLowerCase().includes(qLower) ||
    (s.InvoiceNumber || '').toLowerCase().includes(qLower)
  );

  const matchedProducts = (currentResults.products || []).filter(p => 
    (p.SKU || '').toLowerCase().includes(qLower) ||
    (p.Name || '').toLowerCase().includes(qLower) ||
    (p.Brand || '').toLowerCase().includes(qLower)
  );

  const totalMatches = matchedSales.length + matchedProducts.length;

  if (totalMatches === 0) {
    suggestList.classList.add('hidden');
    return;
  }

  // Render sales suggestions
  matchedSales.slice(0, 5).forEach(s => {
    const row = document.createElement('div');
    row.className = 'px-3 py-2 hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors';
    row.innerHTML = `
      <div class="font-medium text-slate-700">📋 ${escapeHTML(s.OrderNumber)}</div>
      <div class="text-[10px] text-slate-400 font-semibold">${escapeHTML(s.Customer)}</div>
    `;
    row.addEventListener('click', () => {
      searchInput.value = s.OrderNumber;
      hideSuggestions();
      executeSearch(s.OrderNumber);
    });
    suggestList.appendChild(row);
  });

  // Render product suggestions
  matchedProducts.slice(0, 5).forEach(p => {
    const row = document.createElement('div');
    row.className = 'px-3 py-2 hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors';
    row.innerHTML = `
      <div class="font-medium text-slate-700">📦 ${escapeHTML(p.SKU)}</div>
      <div class="text-[10px] text-slate-400 font-semibold">${escapeHTML(p.Name)}</div>
    `;
    row.addEventListener('click', () => {
      searchInput.value = p.SKU;
      hideSuggestions();
      executeSearch(p.SKU);
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
  paginationControls.classList.add('hidden');
  emptyState.classList.remove('hidden');
  
  // Clear any existing unified results lists
  const resultsList = document.getElementById('unified-results-list');
  if (resultsList) resultsList.innerHTML = '';
  
  currentResults = null;
  currentPage = 1;
}

// Perform API global search call
async function executeSearch(query) {
  if (!query) return;

  loader.classList.remove('hidden');
  errorBanner.classList.add('hidden');
  emptyState.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  searchTriageBadge.classList.add('hidden');
  paginationControls.classList.add('hidden');

  const sanitizedUrl = backendUrl.replace(/\/$/, '');
  const searchUrl = `${sanitizedUrl}/api/global-search?query=${encodeURIComponent(query)}`;

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
    currentResults = data;
    applyFilterAndRender();

  } catch (error) {
    console.error("Search failed:", error);
    loader.classList.add('hidden');
    errorMessage.textContent = error.message || "Unable to reach server. Check backend URL configuration.";
    errorBanner.classList.remove('hidden');
  }
}

// Filter & Sort Change listener
if (filterSortSelect) {
  filterSortSelect.addEventListener('change', () => {
    if (!currentResults) return;
    currentPage = 1;
    applyFilterAndRender();
  });
}

// Combine and sort sales and products datasets into a unified array
function getCombinedSortedItems() {
  if (!currentResults) return [];
  
  const sortVal = filterSortSelect ? filterSortSelect.value : 'default';
  const queryText = searchInput.value.trim().toLowerCase();

  const filteredSales = (currentResults.sales || []).filter(s => {
    const status = (s.Status || '').toUpperCase();
    return status !== 'VOID' && status !== 'VOIDED';
  });

  const productsList = currentResults.products || [];

  // Wrap items to identify type
  const combinedItems = [
    ...filteredSales.map(s => ({ type: 'sale', data: s })),
    ...productsList.map(p => ({ type: 'product', data: p }))
  ];

  // Sorting Handler
  if (sortVal === 'default') {
    combinedItems.sort((a, b) => {
      const nameA = a.type === 'sale' ? (a.data.Customer || '') : (a.data.Name || '');
      const nameB = b.type === 'sale' ? (b.data.Customer || '') : (b.data.Name || '');
      const scoreA = getRelevanceScore(nameA, queryText);
      const scoreB = getRelevanceScore(nameB, queryText);
      if (scoreA !== scoreB) return scoreB - scoreA;

      // Group Sales first by default
      if (a.type !== b.type) {
        return a.type === 'sale' ? -1 : 1;
      }

      if (a.type === 'sale') {
        const da = a.data.OrderDate ? new Date(a.data.OrderDate) : new Date(0);
        const db = b.data.OrderDate ? new Date(b.data.OrderDate) : new Date(0);
        return db - da;
      } else {
        return (a.data.SKU || '').localeCompare(b.data.SKU || '');
      }
    });
  } else if (sortVal === 'date-desc') {
    combinedItems.sort((a, b) => {
      const da = a.type === 'sale' ? (a.data.OrderDate ? new Date(a.data.OrderDate) : new Date(0)) : new Date(0);
      const db = b.type === 'sale' ? (b.data.OrderDate ? new Date(b.data.OrderDate) : new Date(0)) : new Date(0);
      return db - da;
    });
  } else if (sortVal === 'date-asc') {
    combinedItems.sort((a, b) => {
      const da = a.type === 'sale' ? (a.data.OrderDate ? new Date(a.data.OrderDate) : new Date(0)) : new Date(0);
      const db = b.type === 'sale' ? (b.data.OrderDate ? new Date(b.data.OrderDate) : new Date(0)) : new Date(0);
      return da - db;
    });
  } else if (sortVal === 'name-az') {
    combinedItems.sort((a, b) => {
      const nameA = a.type === 'sale' ? (a.data.Customer || '') : (a.data.Name || '');
      const nameB = b.type === 'sale' ? (b.data.Customer || '') : (b.data.Name || '');
      return nameA.localeCompare(nameB);
    });
  } else if (sortVal === 'name-za') {
    combinedItems.sort((a, b) => {
      const nameA = a.type === 'sale' ? (a.data.Customer || '') : (a.data.Name || '');
      const nameB = b.type === 'sale' ? (b.data.Customer || '') : (b.data.Name || '');
      return nameB.localeCompare(nameA);
    });
  }

  return combinedItems;
}

function applyFilterAndRender() {
  const combinedItems = getCombinedSortedItems();
  const totalItems = combinedItems.length;

  if (totalItems === 0) {
    resetUI();
    return;
  }

  emptyState.classList.add('hidden');

  // Compute pagination parameters (strictly 10 slots per frame)
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  // Extract dynamic slice for the active page view
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = combinedItems.slice(startIndex, startIndex + PAGE_SIZE);

  // Update Pagination controls
  pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage === totalPages;
  paginationControls.classList.remove('hidden');

  // Update triage priority indicator based on the top match type
  if (pageItems.length > 0) {
    triageType.textContent = pageItems[0].type === 'sale' ? 'Customer Sales' : 'Product Inventory';
    searchTriageBadge.classList.remove('hidden');
  }

  // Populate Unified list container
  let resultsList = document.getElementById('unified-results-list');
  if (!resultsList) {
    resultsList = document.createElement('div');
    resultsList.id = 'unified-results-list';
    resultsList.className = 'space-y-3';
    resultsPanel.appendChild(resultsList);
  }
  resultsList.innerHTML = '';

  pageItems.forEach(item => {
    if (item.type === 'sale') {
      resultsList.appendChild(createSaleCard(item.data));
    } else {
      resultsList.appendChild(createProductCard(item.data));
    }
  });

  resultsPanel.classList.remove('hidden');
}

// Generate Product availability Card element (replaces table view for layout unification)
function createProductCard(product) {
  const sku = product.SKU || 'N/A';
  const name = product.Name || 'Unnamed Product';
  const brand = product.Brand || 'N/A';
  const onHand = product.OnHand !== undefined ? product.OnHand : 0;
  const allocated = product.Allocated !== undefined ? product.Allocated : 0;
  const onOrder = product.OnOrder !== undefined ? product.OnOrder : 0;
  
  const currentStock = onHand - allocated;
  const barcode = product.Barcode || 'N/A';
  const length = product.Length || 0;
  const width = product.Width || 0;
  const height = product.Height || 0;
  const weight = product.Weight || 0;
  const dimBlock = `Barcode: ${escapeHTML(barcode)} | Dim: ${length}x${width}x${height} | Wt: ${weight}`;

  const card = document.createElement('div');
  card.className = 'bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:border-slate-300 transition-colors flex flex-col text-xs';

  // Format Product Family
  let familyHtml = '';
  if (product.Family) {
    familyHtml = `
      <div class="mt-1.5 p-1.5 bg-slate-50 border border-slate-100 rounded">
        <div class="font-bold text-slate-700 text-[8px] uppercase tracking-wider mb-1">Product Family</div>
        <div class="text-[9px] text-slate-600">
          <span class="font-medium text-slate-700">Family Name:</span> ${escapeHTML(product.Family.Name || 'N/A')}
          ${product.Family.SKU ? `<br><span class="font-medium text-slate-700">Family SKU:</span> ${escapeHTML(product.Family.SKU)}` : ''}
        </div>
      </div>
    `;
  }

  // Format BOM components
  let bomHtml = '';
  if (product.BOM && Array.isArray(product.BOM) && product.BOM.length > 0) {
    bomHtml = `
      <div class="mt-1.5 p-1.5 bg-slate-50 border border-slate-100 rounded">
        <div class="font-bold text-slate-700 text-[8px] uppercase tracking-wider mb-1">Components (BOM)</div>
        <ul class="space-y-0.5 list-disc pl-3 text-[9px] text-slate-500">
          ${product.BOM.map(c => `<li><span class="font-medium text-slate-700">${escapeHTML(c.SKU)}</span> (Qty: ${c.Quantity}${c.Name ? ` - ${escapeHTML(c.Name)}` : ''})</li>`).join('')}
        </ul>
      </div>
    `;
  }

  card.innerHTML = `
    <!-- Collapsible Header Summary Row -->
    <div class="card-header flex justify-between items-center cursor-pointer select-none">
      <div class="flex-grow pr-2">
        <h3 class="font-bold text-slate-800 text-[13px] flex items-center space-x-1.5">
          <span class="text-sky-600">📦 ${escapeHTML(sku)}</span>
          <span class="text-[10px] text-slate-400 font-normal">| ${escapeHTML(name)}</span>
        </h3>
        <p class="text-slate-400 font-medium text-[9px] mt-0.5">Brand: ${escapeHTML(brand)}</p>
      </div>
      <div class="flex items-center space-x-2">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          Avail: ${currentStock}
        </span>
        <span class="toggle-icon text-slate-400 font-bold text-xs">▼</span>
      </div>
    </div>

    <!-- Collapsible Details Panel (Hidden by default) -->
    <div class="card-details hidden space-y-2 pt-2.5 mt-2.5 border-t border-slate-100">
      <div class="grid grid-cols-2 gap-2 text-[10px]">
        <div class="bg-slate-50 p-2 rounded border border-slate-100">
          <span class="text-slate-400 block uppercase tracking-wider text-[8px]">On Hand</span>
          <strong class="text-slate-800 text-[11px]">${onHand}</strong>
        </div>
        <div class="bg-slate-50 p-2 rounded border border-slate-100">
          <span class="text-slate-400 block uppercase tracking-wider text-[8px]">Allocated</span>
          <strong class="text-slate-800 text-[11px]">${allocated}</strong>
        </div>
      </div>
      <div class="bg-slate-50 p-2 rounded border border-slate-100 text-[10px] flex justify-between items-center">
        <span class="text-slate-400 uppercase tracking-wider text-[8px]">On Order</span>
        <strong class="text-slate-800">${onOrder}</strong>
      </div>
      <div class="text-[9px] text-slate-400 font-mono select-all bg-slate-50 p-1.5 rounded border border-slate-100">
        ${escapeHTML(dimBlock)}
      </div>
      ${familyHtml}
      ${bomHtml}
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

// Generate Sale Card element (Renders collapsed by default)
function createSaleCard(sale) {
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

  // Nest product availability mapping directly alongside the sales cards
  let linesHtml = '';
  if (sale.OrderLines && sale.OrderLines.length > 0) {
    linesHtml = `
      <div class="border border-slate-100 rounded p-2 space-y-1 text-[10px] bg-white mt-2.5">
        <div class="font-semibold text-slate-700 pb-0.5 border-b border-slate-100 uppercase tracking-wider text-[8px]">Ordered Items & Availability</div>
        <div class="divide-y divide-slate-100">
          ${sale.OrderLines.map(line => {
            const sku = line.SKU || '';
            const name = line.Name || '';
            const quantity = line.Quantity || 0;
            
            let availHtml = '<span class="text-slate-400 font-mono">(No local match)</span>';
            if (currentResults && currentResults.products) {
              const match = currentResults.products.find(p => (p.SKU || '').toLowerCase() === sku.toLowerCase());
              if (match) {
                const stock = (match.OnHand || 0) - (match.Allocated || 0);
                const orderQty = match.OnOrder || 0;
                availHtml = `<span class="text-emerald-700 font-bold">Avail: ${stock}</span> <span class="text-slate-300">|</span> <span class="text-slate-600">OnOrder: ${orderQty}</span>`;
              }
            }

            return `
              <div class="py-1 flex justify-between items-start text-[10px]">
                <div class="pr-2">
                  <div class="font-bold text-slate-800">${escapeHTML(sku)}</div>
                  <div class="text-[9px] text-slate-500 truncate max-w-[180px]">${escapeHTML(name)}</div>
                </div>
                <div class="text-right flex flex-col items-end shrink-0">
                  <div class="font-semibold text-slate-700">Qty: ${quantity}</div>
                  <div class="text-[9px] mt-0.5">${availHtml}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <!-- Collapsible Header Summary Row -->
    <div class="card-header flex justify-between items-center cursor-pointer select-none">
      <div class="flex-grow pr-2">
        <h3 class="font-bold text-slate-800 text-[13px] flex items-center space-x-1.5">
          <span class="text-slate-900">📋 ${escapeHTML(orderNumber)}</span>
          <span class="text-[10px] text-slate-400 font-normal">| ${escapeHTML(customer)}</span>
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
        <div class="flex justify-between"><span class="text-slate-500">Invoice Number:</span> <span class="font-bold text-slate-700">${escapeHTML(invoiceNumber)}</span></div>
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
        <div class="flex justify-between"><span class="text-slate-500">Tracking Numbers:</span> <span class="font-semibold text-sky-700 select-all">${escapeHTML(combinedTracking)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Invoice Amount:</span> <span class="font-bold text-slate-800">$${invoiceAmount.toFixed(2)}</span></div>
        <div class="pt-1 border-t border-slate-100 mt-1"><span class="text-slate-500 block pb-0.5">Shipping Notes:</span> <span class="text-slate-600 block italic leading-normal">${escapeHTML(shippingNotes)}</span></div>
      </div>

      <!-- Embedded Order Lines & availability details -->
      ${linesHtml}

      <div class="grid grid-cols-2 gap-2 pt-1">
        <button class="download-btn sales-order shadow-sm bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded py-1 px-2 font-medium tracking-wide flex items-center justify-center space-x-1 transition-colors" data-id="${escapeHTML(saleId)}" data-type="Sale Order">
          <span>📥 Sales Order</span>
        </button>
        <button class="download-btn invoice shadow-sm bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded py-1 px-2 font-medium tracking-wide flex items-center justify-center space-x-1 transition-colors" data-id="${escapeHTML(saleId)}" data-type="Invoice">
          <span>📥 Invoice</span>
        </button>
      </div>

      <button class="copy-summary-btn w-full bg-slate-800 hover:bg-slate-900 text-white border border-transparent rounded py-1.5 px-2 font-semibold tracking-wide flex items-center justify-center space-x-1 transition-colors shadow-sm" data-summary="Order: ${escapeHTML(orderNumber)} | Customer: ${escapeHTML(customer)} | Status: ${escapeHTML(status)} | Tracking: ${escapeHTML(combinedTracking)}">
        <span>📋 Copy Quick Summary</span>
      </button>
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

  // Attach event listeners to buttons
  card.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const type = btn.getAttribute('data-type');
      const id = btn.getAttribute('data-id');
      await downloadDocument(btn, id, type);
    });
  });

  const copyBtn = card.querySelector('.copy-summary-btn');
  copyBtn.addEventListener('click', () => {
    const summaryText = copyBtn.getAttribute('data-summary');
    navigator.clipboard.writeText(summaryText)
      .then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<span>✅ Copied to Clipboard</span>';
        copyBtn.classList.remove('bg-slate-800');
        copyBtn.classList.add('bg-emerald-600');
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
          copyBtn.classList.remove('bg-emerald-600');
          copyBtn.classList.add('bg-slate-800');
        }, 2000);
      })
      .catch(err => {
        console.error("Clipboard copy failed:", err);
        showStatusAlert("Copy failed", "danger");
      });
  });

  return card;
}

// Download PDF blob from Backend
async function downloadDocument(button, saleId, type) {
  if (!saleId) {
    showStatusAlert("Missing Sale ID", "danger");
    return;
  }

  const originalContent = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span>⏳ Downloading...</span>';

  const sanitizedUrl = backendUrl.replace(/\/$/, '');
  const downloadUrl = `${sanitizedUrl}/api/download-doc?saleId=${encodeURIComponent(saleId)}&documentType=${encodeURIComponent(type)}`;

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
    link.download = `${type.replace(/\s+/g, '_')}_${saleId}.pdf`;
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
