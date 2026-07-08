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
  // Initialize sorting dropdown to default newest first
  if (filterSortSelect) {
    filterSortSelect.value = 'date-desc';
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

// Refined Auto-Suggest Logic: Focus strictly on Customer Name strings
function showSuggestions(query) {
  const suggestList = getOrCreateSuggestList();
  suggestList.innerHTML = '';
  
  if (!currentResults) {
    suggestList.classList.add('hidden');
    return;
  }

  const qLower = query.toLowerCase();
  
  // Only search and filter by Customer Name strings
  const matchedSales = (currentResults.sales || []).filter(s => 
    (s.Customer || '').toLowerCase().includes(qLower)
  );

  // Group by unique Customer Name to avoid duplicate suggestions
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
      searchInput.value = s.Customer;
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
  paginationControls.classList.add('hidden');
  emptyState.classList.remove('hidden');
  
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

  // Enforce "Date: Newest First" as the default sort when a new search executes
  if (filterSortSelect) {
    filterSortSelect.value = 'date-desc';
  }

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
    errorMessage.textContent = error.message || "Unable to reach server. Check backend URL configuration.";
    errorBanner.classList.remove('hidden');
  } finally {
    // Bulletproof Loader spinner hide
    loader.classList.add('hidden');
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
  
  const sortVal = filterSortSelect ? filterSortSelect.value : 'date-desc';
  const queryText = searchInput.value.trim().toLowerCase();

  const filteredSales = (currentResults.sales || []).filter(s => {
    const status = (s.Status || '').toUpperCase();
    return status !== 'VOID' && status !== 'VOIDED';
  });

  const productsList = currentResults.products || [];

  const isProductPriority = currentResults.priorityContext === "product";

  let combinedItems = [];
  if (isProductPriority) {
    // Put products first, then sales
    combinedItems = [
      ...productsList.map(p => ({ type: 'product', data: p })),
      ...filteredSales.map(s => ({ type: 'sale', data: s }))
    ];
  } else {
    // Standard order
    combinedItems = [
      ...filteredSales.map(s => ({ type: 'sale', data: s })),
      ...productsList.map(p => ({ type: 'product', data: p }))
    ];
  }

  // Sorting Handler
  if (sortVal === 'default') {
    combinedItems.sort((a, b) => {
      if (isProductPriority && a.type !== b.type) {
        return a.type === 'product' ? -1 : 1;
      }

      const nameA = a.type === 'sale' ? (a.data.Customer || '') : (a.data.FamilyName || a.data.Name || '');
      const nameB = b.type === 'sale' ? (b.data.Customer || '') : (b.data.FamilyName || b.data.Name || '');
      const scoreA = getRelevanceScore(nameA, queryText);
      const scoreB = getRelevanceScore(nameB, queryText);
      if (scoreA !== scoreB) return scoreB - scoreA;

      if (a.type !== b.type) {
        return a.type === 'sale' ? -1 : 1;
      }

      if (a.type === 'sale') {
        const da = a.data.OrderDate ? new Date(a.data.OrderDate) : new Date(0);
        const db = b.data.OrderDate ? new Date(b.data.OrderDate) : new Date(0);
        return db - da;
      } else {
        return (a.data.FamilyName || a.data.Name || '').localeCompare(b.data.FamilyName || b.data.Name || '');
      }
    });
  } else if (sortVal === 'date-desc') {
    combinedItems.sort((a, b) => {
      if (isProductPriority && a.type !== b.type) {
        return a.type === 'product' ? -1 : 1;
      }
      const da = a.type === 'sale' ? (a.data.OrderDate ? new Date(a.data.OrderDate) : new Date(0)) : new Date(0);
      const db = b.type === 'sale' ? (b.data.OrderDate ? new Date(b.data.OrderDate) : new Date(0)) : new Date(0);
      return db - da;
    });
  } else if (sortVal === 'date-asc') {
    combinedItems.sort((a, b) => {
      if (isProductPriority && a.type !== b.type) {
        return a.type === 'product' ? -1 : 1;
      }
      const da = a.type === 'sale' ? (a.data.OrderDate ? new Date(a.data.OrderDate) : new Date(0)) : new Date(0);
      const db = b.type === 'sale' ? (b.data.OrderDate ? new Date(b.data.OrderDate) : new Date(0)) : new Date(0);
      return da - db;
    });
  } else if (sortVal === 'name-az') {
    combinedItems.sort((a, b) => {
      if (isProductPriority && a.type !== b.type) {
        return a.type === 'product' ? -1 : 1;
      }
      const nameA = a.type === 'sale' ? (a.data.Customer || '') : (a.data.FamilyName || a.data.Name || '');
      const nameB = b.type === 'sale' ? (b.data.Customer || '') : (b.data.FamilyName || b.data.Name || '');
      return nameA.localeCompare(nameB);
    });
  } else if (sortVal === 'name-za') {
    combinedItems.sort((a, b) => {
      if (isProductPriority && a.type !== b.type) {
        return a.type === 'product' ? -1 : 1;
      }
      const nameA = a.type === 'sale' ? (a.data.Customer || '') : (a.data.FamilyName || a.data.Name || '');
      const nameB = b.type === 'sale' ? (b.data.Customer || '') : (b.data.FamilyName || b.data.Name || '');
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

  // Compute pagination parameters
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  // Extract page items slice
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = combinedItems.slice(startIndex, startIndex + PAGE_SIZE);

  pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage === totalPages;
  paginationControls.classList.remove('hidden');

  if (pageItems.length > 0) {
    triageType.textContent = pageItems[0].type === 'sale' ? 'Customer Sales' : 'Product Inventory';
    searchTriageBadge.classList.remove('hidden');
  }

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

// Generate Grouped Product Family Card element (collapsible)
function createProductCard(product) {
  const familyName = product.FamilyName || 'Unnamed Family';
  const brand = product.Brand || 'N/A';
  const variants = product.Variants || [];

  const card = document.createElement('div');
  card.className = 'bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:border-slate-300 transition-colors flex flex-col text-xs';

  // Build variant grid rows HTML (sorted alphabetically by SKU in backend)
  const variantsHtml = variants.map(v => {
    const availStock = (v.OnHand || 0) - (v.Allocated || 0);
    const onOrder = v.OnOrder || 0;
    const wsPrice = (v.PriceTier1 || 0).toFixed(2);
    const rrpPrice = (v.PriceTier5 || 0).toFixed(2);
    const taxRule = v.SaleTaxRule || 'N/A';

    return `
      <div class="grid grid-cols-3 gap-2 py-2.5 border-b border-slate-100 last:border-0 text-[10px] items-center">
        <!-- Column 1: SKU & Name/Description -->
        <div class="pr-1">
          <div class="font-bold text-slate-800 break-all">${escapeHTML(v.SKU)}</div>
          <div class="text-slate-500 break-words text-[9px] mt-0.5">${escapeHTML(v.Name)}</div>
        </div>
        <!-- Column 2: Inventory Status -->
        <div class="text-slate-600 border-l border-slate-100 pl-2">
          <div>Stock Available: <strong class="text-emerald-700 font-semibold">${availStock}</strong></div>
          <div class="text-[9px] mt-0.5 text-slate-400">On Order: ${onOrder}</div>
        </div>
        <!-- Column 3: Commercial Meta -->
        <div class="text-slate-600 border-l border-slate-100 pl-2 text-right">
          <div>WS: <strong class="text-slate-800 font-semibold">$${wsPrice}</strong></div>
          <div>RRP (incl GST): <strong class="text-slate-800 font-semibold">$${rrpPrice}</strong></div>
          <div class="text-[8px] text-slate-400 mt-0.5 truncate" title="${escapeHTML(taxRule)}">Tax: ${escapeHTML(taxRule)}</div>
        </div>
      </div>
    `;
  }).join('');

  card.innerHTML = `
    <!-- Header Block (Collapsible Toggle) -->
    <div class="card-header flex justify-between items-center cursor-pointer select-none">
      <div class="flex-grow pr-2">
        <h3 class="font-bold text-slate-800 text-[13px] flex items-center space-x-1.5">
          <span class="text-sky-600">📦 ${escapeHTML(familyName)}</span>
        </h3>
        <p class="text-slate-400 font-medium text-[9px] mt-0.5">Brand: ${escapeHTML(brand)}</p>
      </div>
      <div class="flex items-center space-x-2">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
          ${variants.length} ${variants.length === 1 ? 'Variant' : 'Variants'}
        </span>
        <span class="toggle-icon text-slate-400 font-bold text-xs">▼</span>
      </div>
    </div>

    <!-- Collapsible Details Panel (Variants Grid) -->
    <div class="card-details ${variants.length > 1 ? 'hidden' : ''} pt-2 mt-2 border-t border-slate-100">
      <div class="bg-slate-50/50 rounded-lg p-2.5 border border-slate-100 divide-y divide-slate-100">
        ${variantsHtml}
      </div>
    </div>
  `;

  // Click handler to toggle collapsed details
  const header = card.querySelector('.card-header');
  const details = card.querySelector('.card-details');
  const toggleIcon = card.querySelector('.toggle-icon');
  
  if (variants.length <= 1) {
    toggleIcon.textContent = '▲';
  }

  header.addEventListener('click', () => {
    const isHidden = details.classList.toggle('hidden');
    toggleIcon.textContent = isHidden ? '▼' : '▲';
  });

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

// Generate Sale Card element (Renders collapsed by default, zero copy/download buttons)
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

  // Nest product availability mapping inside card, sorted alphabetically by SKU
  let linesHtml = '';
  if (sale.OrderLines && sale.OrderLines.length > 0) {
    // Apply strict alphabetical sort on product SKU
    const sortedLines = [...sale.OrderLines].sort((a, b) => 
      (a.SKU || '').toLowerCase().localeCompare((b.SKU || '').toLowerCase())
    );

    linesHtml = `
      <div class="border border-slate-100 rounded p-2 space-y-1 text-[10px] bg-white mt-2.5">
        <div class="font-semibold text-slate-700 pb-0.5 border-b border-slate-100 uppercase tracking-wider text-[8px]">ORDERED ITEMS</div>
        <div class="divide-y divide-slate-100">
          ${sortedLines.map(line => {
            const sku = line.SKU || '';
            const name = line.Name || '';
            const quantity = line.Quantity || 0;
            
            let availHtml = '';
            if (currentResults && currentResults.products) {
              // Find matching variant SKU within grouped families
              let match = null;
              for (const family of currentResults.products) {
                const found = (family.Variants || []).find(v => (v.SKU || '').toLowerCase() === sku.toLowerCase());
                if (found) {
                  match = found;
                  break;
                }
              }
              if (match) {
                const stock = (match.OnHand || 0) - (match.Allocated || 0);
                const orderQty = match.OnOrder || 0;
                availHtml = `<span class="text-emerald-700 font-bold">Avail: ${stock}</span> <span class="text-slate-300">|</span> <span class="text-slate-600">OnOrder: ${orderQty}</span>`;
              }
            }

            return `
              <div class="py-2 flex justify-between items-center text-[10px]">
                <div class="flex-grow pr-3 flex flex-col">
                  <div class="font-bold text-slate-800">${escapeHTML(sku)}</div>
                  <div class="text-[11px] text-slate-500 leading-tight mt-0.5 whitespace-normal break-words">${escapeHTML(name)}</div>
                  ${availHtml ? `<div class="text-[9px] mt-1">${availHtml}</div>` : ''}
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
