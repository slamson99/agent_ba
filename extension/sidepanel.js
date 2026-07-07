// DOM Elements
const searchInput = document.getElementById('global-search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const loader = document.getElementById('loader');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');
const emptyState = document.getElementById('empty-state');
const resultsPanel = document.getElementById('results-panel');
const salesSection = document.getElementById('sales-results');
const salesList = document.getElementById('sales-list');
const salesCount = document.getElementById('sales-count');
const productsSection = document.getElementById('products-results');
const productsList = document.getElementById('products-list');
const productsCount = document.getElementById('products-count');
const searchTriageBadge = document.getElementById('search-triage-badge');
const triageType = document.getElementById('triage-type');

// Tab DOM Elements
const tabSales = document.getElementById('tab-sales');
const tabProducts = document.getElementById('tab-products');

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

// Constants & Overhauled Filtering/Pagination State
const DEFAULT_BACKEND_URL = 'https://agent-ba.vercel.app';
let backendUrl = DEFAULT_BACKEND_URL;

let activeScope = 'sales'; // Default active tab scope
let currentResults = null; // Full dataset cached in memory
const PAGE_SIZE = 10;      // Enforce limit of 10 items per page
let currentPage = 1;

const filterSortSelect = document.getElementById('filter-sort');

// Initialize Settings
document.addEventListener('DOMContentLoaded', () => {
  // Load backend URL from storage
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

// Tab Switch Click Handlers
if (tabSales) {
  tabSales.addEventListener('click', () => selectTab('sales'));
}
if (tabProducts) {
  tabProducts.addEventListener('click', () => selectTab('products'));
}

function selectTab(scope) {
  if (activeScope === scope) return;
  activeScope = scope;
  currentPage = 1;

  // Instantly toggle active tab visual classes
  if (activeScope === 'sales') {
    tabSales.className = "flex-1 py-2.5 text-center border-b-2 border-slate-800 bg-white text-slate-800 focus:outline-none";
    tabProducts.className = "flex-1 py-2.5 text-center border-b-2 border-transparent text-slate-500 hover:text-slate-800 focus:outline-none";
  } else {
    tabProducts.className = "flex-1 py-2.5 text-center border-b-2 border-slate-800 bg-white text-slate-800 focus:outline-none";
    tabSales.className = "flex-1 py-2.5 text-center border-b-2 border-transparent text-slate-500 hover:text-slate-800 focus:outline-none";
  }

  // Refresh results with scope context
  const query = searchInput.value.trim();
  if (query.length > 0) {
    executeSearch(query);
  } else {
    resetUI();
  }
}

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
    const items = activeScope === 'sales' ? (currentResults.sales || []) : (currentResults.products || []);
    const totalPages = Math.ceil(items.length / PAGE_SIZE) || 1;
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

// Auto-Suggest Event Binding (Lightweight instant suggestion filtering)
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  
  // Show/Hide Clear button
  if (query.length > 0) {
    clearSearchBtn.classList.remove('hidden');
  } else {
    clearSearchBtn.classList.add('hidden');
    resetUI();
    hideSuggestions();
    return;
  }

  if (query.length > 2) {
    showSuggestions(query);
  } else {
    hideSuggestions();
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
  salesSection.classList.add('hidden');
  productsSection.classList.add('hidden');
  searchTriageBadge.classList.add('hidden');
  paginationControls.classList.add('hidden');
  emptyState.classList.remove('hidden');
  currentResults = null;
  currentPage = 1;
}

// Perform API global search call
async function executeSearch(query) {
  if (!query) return;

  // Show Loading state
  loader.classList.remove('hidden');
  errorBanner.classList.add('hidden');
  emptyState.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  searchTriageBadge.classList.add('hidden');
  paginationControls.classList.add('hidden');

  const sanitizedUrl = backendUrl.replace(/\/$/, '');
  
  // Pass activeScope parameter so backend ignores other queries entirely
  const searchUrl = `${sanitizedUrl}/api/global-search?query=${encodeURIComponent(query)}&scope=${activeScope}`;

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
    currentPage = 1; // Reset to page 1 on filter change
    applyFilterAndRender();
  });
}

function applyFilterAndRender() {
  const sortVal = filterSortSelect ? filterSortSelect.value : 'default';
  const queryText = searchInput.value.trim();
  
  // Clone results to avoid mutating original state
  const dataCopy = {
    ...currentResults,
    sales: currentResults.sales ? [...currentResults.sales] : [],
    products: currentResults.products ? [...currentResults.products] : []
  };

  // Sort Sales
  if (dataCopy.sales.length > 0) {
    if (sortVal === 'default') {
      // Smart sorting: Relevance first (exact/prefix top), fall back to OrderDate (most recent first)
      dataCopy.sales.sort((a, b) => {
        const scoreA = getRelevanceScore(a.Customer, queryText);
        const scoreB = getRelevanceScore(b.Customer, queryText);
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
        const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
        return db - da;
      });
    } else if (sortVal === 'date-desc') {
      dataCopy.sales.sort((a, b) => {
        const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
        const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
        return db - da;
      });
    } else if (sortVal === 'date-asc') {
      dataCopy.sales.sort((a, b) => {
        const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
        const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
        return da - db;
      });
    } else if (sortVal === 'name-az') {
      dataCopy.sales.sort((a, b) => (a.Customer || '').localeCompare(b.Customer || ''));
    } else if (sortVal === 'name-za') {
      dataCopy.sales.sort((a, b) => (b.Customer || '').localeCompare(a.Customer || ''));
    }
  }

  // Sort Products
  if (dataCopy.products.length > 0) {
    if (sortVal === 'default') {
      dataCopy.products.sort((a, b) => {
        const scoreA = getRelevanceScore(a.Name, queryText);
        const scoreB = getRelevanceScore(b.Name, queryText);
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        return (a.SKU || '').localeCompare(b.SKU || '');
      });
    } else if (sortVal === 'name-az') {
      dataCopy.products.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
    } else if (sortVal === 'name-za') {
      dataCopy.products.sort((a, b) => (b.Name || '').localeCompare(a.Name || ''));
    }
  }

  renderResults(dataCopy);
}

// Render dynamic results with client-side pagination
function renderResults(data) {
  loader.classList.add('hidden');

  // Notify user of any backend partial failures
  if (data.errors) {
    const failedApis = [];
    if (data.errors.sales) failedApis.push('Sales Orders');
    if (data.errors.products) failedApis.push('Products');
    if (failedApis.length > 0) {
      console.warn("Backend API partial failures:", data.errors);
      showStatusAlert(`Warning: Failed to retrieve data from Cin7`, 'warning');
    }
  }

  const { sales, products } = data;
  
  // Filter out VOID/VOIDED transactions on the client side for absolute safety
  const filteredSales = (sales || []).filter(s => {
    const status = (s.Status || '').toUpperCase();
    return status !== 'VOID' && status !== 'VOIDED';
  });

  // Isolate current items pool based on active scope
  const items = activeScope === 'sales' ? filteredSales : (products || []);
  const totalItems = items.length;

  if (totalItems === 0) {
    salesSection.classList.add('hidden');
    productsSection.classList.add('hidden');
    paginationControls.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  // Compute pagination parameters (strictly 10 slots per frame)
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  // Extract dynamic slice for the active page view
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = items.slice(startIndex, startIndex + PAGE_SIZE);

  // Update Pagination controls
  pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage === totalPages;
  paginationControls.classList.remove('hidden');

  // Set up search triage badge
  triageType.textContent = activeScope === 'sales' ? 'Sales Orders' : 'Product Availability';
  searchTriageBadge.classList.remove('hidden');

  // Populate sections
  if (activeScope === 'sales') {
    salesCount.textContent = totalItems;
    salesList.innerHTML = '';
    pageItems.forEach(sale => {
      salesList.appendChild(createSaleCard(sale));
    });
    salesSection.classList.remove('hidden');
    productsSection.classList.add('hidden');
    resultsPanel.appendChild(salesSection);
  } else {
    productsCount.textContent = totalItems;
    productsList.innerHTML = '';
    pageItems.forEach(product => {
      productsList.appendChild(createProductRow(product));
    });
    productsSection.classList.remove('hidden');
    salesSection.classList.add('hidden');
    resultsPanel.appendChild(productsSection);
  }

  resultsPanel.classList.remove('hidden');
}

// Generate Sale Card element
function createSaleCard(sale) {
  // Extract details (guarantee string values)
  const saleId = sale.ID || '';
  const orderNumber = sale.OrderNumber || 'Unassigned';
  const status = sale.Status || 'Draft';
  const orderDate = sale.OrderDate || 'N/A';
  
  const invoiceNumber = sale.InvoiceNumber || 'N/A';
  const customerReference = sale.CustomerReference || 'N/A';
  
  const customer = sale.Customer || 'Unknown Customer';
  const email = sale.Email || 'N/A';
  const salesRep = sale.SalesRepresentative || 'N/A';
  const discount = sale.Discount !== undefined ? sale.Discount : 0;
  const attribute6 = sale.AdditionalAttribute6 || 'N/A';
  
  const fulfilmentStatus = sale.FulFilmentStatus || 'N/A';
  const combinedTracking = sale.CombinedTrackingNumbers || 'N/A';
  const invoiceAmount = sale.InvoiceAmount !== undefined ? sale.InvoiceAmount : 0;
  const shippingNotes = sale.ShippingNotes || 'N/A';

  // Invoice accounting fields
  const invoiceDueDate = sale.InvoiceDueDate || 'N/A';
  const paymentStatus = sale.PaymentStatus || 'UNPAID';

  const card = document.createElement('div');
  card.className = 'bg-white border border-slate-200 rounded-lg p-3 shadow-sm hover:border-slate-300 transition-colors flex flex-col text-xs';

  card.innerHTML = `
    <!-- Collapsible Header Summary Row -->
    <div class="card-header flex justify-between items-center cursor-pointer select-none">
      <div class="flex-grow pr-2">
        <h3 class="font-bold text-slate-800 text-[13px] flex items-center space-x-1.5">
          <span>${escapeHTML(orderNumber)}</span>
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

      <!-- Logistics & Billing Panel (Includes Invoice Status and Due Date) -->
      <div class="border border-slate-100 rounded p-2 space-y-1 text-[10px] bg-slate-50/50">
        <div class="font-semibold text-slate-700 pb-0.5 border-b border-slate-100 uppercase tracking-wider text-[8px] flex justify-between items-center">
          <span>Logistics & Billing</span>
          <span class="font-bold text-[9px]">${paymentStatus === 'PAID' ? '🟩 PAID' : '🟨 UNPAID / PARTIALLY PAID'}</span>
        </div>
        <div class="flex justify-between"><span class="text-slate-500">Invoice Due Date:</span> <span class="font-semibold text-slate-700">${escapeHTML(invoiceDueDate)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Fulfillment Status:</span> <span class="font-semibold text-slate-700">${escapeHTML(fulfilmentStatus)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Tracking Numbers:</span> <span class="font-semibold text-sky-700 select-all">${escapeHTML(combinedTracking)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Invoice Amount:</span> <span class="font-bold text-slate-800">$${invoiceAmount.toFixed(2)}</span></div>
        <div class="pt-1 border-t border-slate-100 mt-1"><span class="text-slate-500 block pb-0.5">Shipping Notes:</span> <span class="text-slate-600 block italic leading-normal">${escapeHTML(shippingNotes)}</span></div>
      </div>

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

// Generate Product Row element
function createProductRow(product) {
  const fragment = document.createDocumentFragment();

  const mainRow = document.createElement('tr');
  mainRow.className = 'border-t border-slate-200 hover:bg-slate-50 transition-colors font-medium text-slate-800 cursor-pointer select-none';

  const sku = product.SKU || 'N/A';
  const name = product.Name || 'Unnamed Product';
  const brand = product.Brand || 'N/A';
  
  const onHand = product.OnHand !== undefined ? product.OnHand : 0;
  const allocated = product.Allocated !== undefined ? product.Allocated : 0;
  const onOrder = product.OnOrder !== undefined ? product.OnOrder : 0;
  
  // Calculate Stock levels
  const available = onHand - allocated;
  const currentStock = available - allocated;

  mainRow.innerHTML = `
    <td class="px-2.5 py-2 font-semibold text-slate-800 tracking-tight">${escapeHTML(sku)}</td>
    <td class="px-2.5 py-2 text-slate-600 truncate max-w-[120px]" title="${escapeHTML(name)}">${escapeHTML(name)}</td>
    <td class="px-2.5 py-2 text-slate-500 flex justify-between items-center">
      <span>${escapeHTML(brand)}</span>
      <span class="toggle-icon text-slate-400 font-mono text-[9px] ml-1">▼</span>
    </td>
  `;
  fragment.appendChild(mainRow);

  const detailRow = document.createElement('tr');
  detailRow.className = 'bg-slate-50/50 border-b border-slate-100 text-[10px] text-slate-600';

  // Format dimensions and weights
  const barcode = product.Barcode || 'N/A';
  const length = product.Length || 0;
  const width = product.Width || 0;
  const height = product.Height || 0;
  const weight = product.Weight || 0;
  const dimBlock = `Barcode: ${escapeHTML(barcode)} | Dim: ${length}x${width}x${height} | Wt: ${weight}`;

  // Format Product Family details if present
  let familyHtml = '';
  if (product.Family) {
    familyHtml = `
      <div class="mt-1.5 p-1.5 bg-white border border-slate-100 rounded">
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
      <div class="mt-1.5 p-1.5 bg-white border border-slate-100 rounded">
        <div class="font-bold text-slate-700 text-[8px] uppercase tracking-wider mb-1">Components (BOM)</div>
        <ul class="space-y-0.5 list-disc pl-3 text-[9px] text-slate-500">
          ${product.BOM.map(c => `<li><span class="font-medium text-slate-700">${escapeHTML(c.SKU)}</span> (Qty: ${c.Quantity}${c.Name ? ` - ${escapeHTML(c.Name)}` : ''})</li>`).join('')}
        </ul>
      </div>
    `;
  }

  detailRow.innerHTML = `
    <td colspan="3" class="px-2.5 pb-2.5 pt-0.5">
      <!-- Collapsible Details Panel (Hidden by default) -->
      <div class="card-details hidden flex flex-col space-y-1">
        <div class="flex items-center space-x-3 text-[10px]">
          <span class="font-medium">Current Stock: <strong class="text-sky-700 font-bold">${currentStock}</strong></span>
          <span class="text-slate-300">|</span>
          <span class="font-medium">On Order: <strong class="text-slate-700">${onOrder}</strong></span>
        </div>
        <div class="text-[9px] text-slate-400 select-all font-mono leading-none pt-0.5">
          ${escapeHTML(dimBlock)}
        </div>
        ${familyHtml}
        ${bomHtml}
      </div>
    </td>
  `;
  fragment.appendChild(detailRow);

  // Click handler to toggle collapsed details
  const detailsContainer = detailRow.querySelector('.card-details');
  const toggleIcon = mainRow.querySelector('.toggle-icon');
  mainRow.addEventListener('click', () => {
    const isHidden = detailsContainer.classList.toggle('hidden');
    toggleIcon.textContent = isHidden ? '▼' : '▲';
  });

  return fragment;
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
    
    // Trigger browser file download
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${type.replace(/\s+/g, '_')}_${saleId}.pdf`;
    document.body.appendChild(link);
    link.click();
    
    // Clean up
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);

    // Show Success state on button
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

// Helper to escape HTML special characters to prevent attribute and script injection issues
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
