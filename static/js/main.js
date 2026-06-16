/**
 * BigQuery Release Notes Dashboard - Frontend Logic
 * Implements real-time filtering, searching, local bookmark storage,
 * dynamic CSS progress counters, and a custom Tweet composer modal.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Application State
    const state = {
        updates: [],
        filteredUpdates: [],
        filters: {
            type: 'all', // 'all', 'feature', 'issue', 'changed', 'deprecation', 'bookmarked'
            search: ''
        },
        bookmarks: new Set(JSON.parse(localStorage.getItem('bq_bookmarks') || '[]')),
        currentTweetNote: null,
        tweetTemplateIndex: 0
    };

    // DOM Elements
    const elements = {
        btnRefresh: document.getElementById('btn-refresh'),
        refreshIcon: document.getElementById('refresh-icon'),
        lastUpdatedText: document.getElementById('last-updated-text'),
        
        // Stats Cards
        statAll: document.getElementById('stat-all'),
        statFeature: document.getElementById('stat-feature'),
        statIssue: document.getElementById('stat-issue'),
        statChanged: document.getElementById('stat-changed'),
        statBookmarked: document.getElementById('stat-bookmarked'),
        
        countAll: document.getElementById('count-all'),
        countFeature: document.getElementById('count-feature'),
        countIssue: document.getElementById('count-issue'),
        countChanged: document.getElementById('count-changed'),
        countBookmarked: document.getElementById('count-bookmarked'),
        
        // Search & Filter Panel
        searchInput: document.getElementById('search-input'),
        searchClear: document.getElementById('search-clear'),
        filterChips: document.querySelectorAll('.chip'),
        
        // States Views
        loadingState: document.getElementById('loading-state'),
        errorState: document.getElementById('error-state'),
        errorMessage: document.getElementById('error-message'),
        emptyState: document.getElementById('empty-state'),
        releasesGrid: document.getElementById('releases-grid'),
        btnRetry: document.getElementById('btn-retry'),
        btnClearFilters: document.getElementById('btn-clear-filters'),
        
        // Tweet Modal
        tweetModal: document.getElementById('tweet-modal'),
        tweetTextarea: document.getElementById('tweet-textarea'),
        btnSuggestTweet: document.getElementById('btn-suggest-tweet'),
        charProgress: document.getElementById('char-progress'),
        charCount: document.getElementById('char-count'),
        charWarning: document.getElementById('char-warning'),
        modalRefType: document.getElementById('modal-ref-type'),
        modalRefDate: document.getElementById('modal-ref-date'),
        modalRefText: document.getElementById('modal-ref-text'),
        btnSendTweet: document.getElementById('btn-send-tweet'),
        btnCancelTweet: document.getElementById('btn-cancel-tweet'),
        btnCloseModal: document.getElementById('btn-close-modal'),
        
        // Toast
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toast-message')
    };

    // Constants
    const CHAR_LIMIT = 280;
    const RING_CIRCUMFERENCE = 2 * Math.PI * 9; // radius = 9 => ~56.548

    // Initialize progress ring stroke dash array
    if (elements.charProgress) {
        elements.charProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`;
        elements.charProgress.style.strokeDashoffset = RING_CIRCUMFERENCE;
    }

    // Initialize Application
    init();

    function init() {
        registerEventListeners();
        fetchReleaseNotes();
    }

    // ==========================================================================
    // Event Listeners Registration
    // ==========================================================================
    function registerEventListeners() {
        // Refresh & Retry
        elements.btnRefresh.addEventListener('click', () => fetchReleaseNotes(true));
        elements.btnRetry.addEventListener('click', () => fetchReleaseNotes(true));
        
        // Searching
        elements.searchInput.addEventListener('input', handleSearchInput);
        elements.searchClear.addEventListener('click', clearSearch);
        
        // Filter Chips Click
        elements.filterChips.forEach(chip => {
            chip.addEventListener('click', () => {
                const type = chip.getAttribute('data-type');
                setFilterType(type);
            });
        });
        
        // Stats Cards Click (also triggers filtering)
        [elements.statAll, elements.statFeature, elements.statIssue, elements.statChanged, elements.statBookmarked].forEach(card => {
            card.addEventListener('click', () => {
                const type = card.getAttribute('data-filter');
                setFilterType(type);
            });
        });

        // Clear Filters Action (from Empty State)
        elements.btnClearFilters.addEventListener('click', () => {
            clearSearch();
            setFilterType('all');
        });

        // Tweet Modal Events
        elements.tweetTextarea.addEventListener('input', updateCharCount);
        elements.btnSuggestTweet.addEventListener('click', rotateTweetTemplates);
        elements.btnSendTweet.addEventListener('click', performTweetAction);
        elements.btnCancelTweet.addEventListener('click', closeModal);
        elements.btnCloseModal.addEventListener('click', closeModal);
        elements.tweetModal.addEventListener('click', (e) => {
            if (e.target === elements.tweetModal) closeModal();
        });

        // ESC key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !elements.tweetModal.classList.contains('hidden')) {
                closeModal();
            }
        });
    }

    // ==========================================================================
    // Data Fetching & State
    // ==========================================================================
    async function fetchReleaseNotes(forceRefresh = false) {
        showLoading(true);
        try {
            const url = `/api/releases${forceRefresh ? '?refresh=true' : ''}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            if (data.success) {
                state.updates = data.updates;
                elements.lastUpdatedText.textContent = `Last checked: ${data.last_updated_str}`;
                updateStats();
                applyFiltersAndRender();
            } else {
                throw new Error(data.error || 'Failed to fetch release notes.');
            }
        } catch (error) {
            console.error('Error fetching release notes:', error);
            showError(error.message);
        } finally {
            showLoading(false);
        }
    }

    function showLoading(isLoading) {
        if (isLoading) {
            elements.loadingState.classList.remove('hidden');
            elements.errorState.classList.add('hidden');
            elements.releasesGrid.classList.add('hidden');
            elements.emptyState.classList.add('hidden');
            elements.btnRefresh.classList.add('spinning');
            elements.btnRefresh.disabled = true;
        } else {
            elements.btnRefresh.classList.remove('spinning');
            elements.btnRefresh.disabled = false;
        }
    }

    function showError(message) {
        elements.loadingState.classList.add('hidden');
        elements.releasesGrid.classList.add('hidden');
        elements.emptyState.classList.add('hidden');
        elements.errorState.classList.remove('hidden');
        elements.errorMessage.textContent = message || 'An unknown error occurred while retrieving updates.';
    }

    // ==========================================================================
    // Search & Filtering Logic
    // ==========================================================================
    function handleSearchInput(e) {
        state.filters.search = e.target.value.toLowerCase().trim();
        
        // Show/hide search clear button
        if (state.filters.search.length > 0) {
            elements.searchClear.style.display = 'block';
        } else {
            elements.searchClear.style.display = 'none';
        }
        
        applyFiltersAndRender();
    }

    function clearSearch() {
        elements.searchInput.value = '';
        state.filters.search = '';
        elements.searchClear.style.display = 'none';
        applyFiltersAndRender();
    }

    function setFilterType(type) {
        state.filters.type = type;
        
        // Update active chip state
        elements.filterChips.forEach(chip => {
            if (chip.getAttribute('data-type') === type) {
                chip.classList.add('active');
            } else {
                chip.classList.remove('active');
            }
        });

        applyFiltersAndRender();
    }

    function applyFiltersAndRender() {
        const { type, search } = state.filters;
        
        state.filteredUpdates = state.updates.filter(update => {
            // Category/Type Filter
            const typeLower = update.type.toLowerCase();
            
            let matchesType = false;
            if (type === 'all') {
                matchesType = true;
            } else if (type === 'feature') {
                matchesType = typeLower === 'feature';
            } else if (type === 'issue') {
                matchesType = typeLower === 'issue';
            } else if (type === 'changed') {
                matchesType = typeLower === 'changed';
            } else if (type === 'deprecation') {
                matchesType = typeLower === 'deprecation';
            } else if (type === 'bookmarked') {
                matchesType = state.bookmarks.has(update.id);
            } else {
                // If it is another unclassified type
                matchesType = typeLower === type;
            }

            // Keyword search filter
            let matchesSearch = true;
            if (search.length > 0) {
                const inType = typeLower.includes(search);
                const inDate = update.date.toLowerCase().includes(search);
                const inText = update.text_content.toLowerCase().includes(search);
                matchesSearch = inType || inDate || inText;
            }

            return matchesType && matchesSearch;
        });

        renderGrid();
    }

    // ==========================================================================
    // UI Rendering
    // ==========================================================================
    function updateStats() {
        const total = state.updates.length;
        const features = state.updates.filter(u => u.type.toLowerCase() === 'feature').length;
        const issues = state.updates.filter(u => u.type.toLowerCase() === 'issue').length;
        const changes = state.updates.filter(u => u.type.toLowerCase() === 'changed').length;
        const bookmarksCount = state.bookmarks.size;

        elements.countAll.textContent = total;
        elements.countFeature.textContent = features;
        elements.countIssue.textContent = issues;
        elements.countChanged.textContent = changes;
        elements.countBookmarked.textContent = bookmarksCount;
    }

    function renderGrid() {
        elements.loadingState.classList.add('hidden');
        
        if (state.filteredUpdates.length === 0) {
            elements.releasesGrid.classList.add('hidden');
            elements.emptyState.classList.remove('hidden');
            return;
        }

        elements.emptyState.classList.add('hidden');
        elements.releasesGrid.innerHTML = '';
        elements.releasesGrid.classList.remove('hidden');

        // Create document fragment to render efficiently
        const fragment = document.createDocumentFragment();

        state.filteredUpdates.forEach(update => {
            const card = document.createElement('div');
            const typeClass = update.type.toLowerCase();
            const isBookmarked = state.bookmarks.has(update.id);
            
            card.className = `release-card type-${typeClass}`;
            
            // Map type header to clean HTML markup
            let badgeClass = 'badge-general';
            if (typeClass === 'feature') badgeClass = 'badge-feature';
            else if (typeClass === 'issue') badgeClass = 'badge-issue';
            else if (typeClass === 'changed') badgeClass = 'badge-changed';
            else if (typeClass === 'deprecation') badgeClass = 'badge-deprecation';

            card.innerHTML = `
                <div class="card-header">
                    <span class="badge ${badgeClass}">${update.type}</span>
                    <button class="btn-bookmark ${isBookmarked ? 'bookmarked' : ''}" data-id="${update.id}" aria-label="${isBookmarked ? 'Remove bookmark' : 'Bookmark this update'}">
                        <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
                    </button>
                </div>
                
                <div class="card-date">
                    <i class="fa-regular fa-calendar"></i>
                    <span>${update.date}</span>
                </div>
                
                <div class="card-body">
                    ${update.content}
                </div>
                
                <div class="card-footer">
                    <div class="footer-left">
                        <button class="btn-card-action btn-copy" data-id="${update.id}" title="Copy raw update details">
                            <i class="fa-regular fa-copy"></i>
                        </button>
                        <a href="${update.link}" target="_blank" rel="noopener noreferrer" class="btn-card-action btn-link" title="Open official GCloud Release Notes Page">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </a>
                    </div>
                    <button class="btn-tweet" data-id="${update.id}">
                        <i class="fa-brands fa-x-twitter"></i>
                        <span>Tweet Update</span>
                    </button>
                </div>
            `;

            // Attach event listeners inside the cards
            // Bookmark Action
            const bookmarkBtn = card.querySelector('.btn-bookmark');
            bookmarkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleBookmark(update.id, bookmarkBtn);
            });

            // Copy Action
            const copyBtn = card.querySelector('.btn-copy');
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                copyToClipboard(update);
            });

            // Tweet Action
            const tweetBtn = card.querySelector('.btn-tweet');
            tweetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openTweetModal(update);
            });

            fragment.appendChild(card);
        });

        elements.releasesGrid.appendChild(fragment);
    }

    // ==========================================================================
    // Bookmarking Actions
    // ==========================================================================
    function toggleBookmark(id, buttonEl) {
        const icon = buttonEl.querySelector('i');
        if (state.bookmarks.has(id)) {
            state.bookmarks.delete(id);
            buttonEl.classList.remove('bookmarked');
            icon.className = 'fa-regular fa-bookmark';
            showToast('Removed from Bookmarks');
        } else {
            state.bookmarks.add(id);
            buttonEl.classList.add('bookmarked');
            icon.className = 'fa-solid fa-bookmark';
            showToast('Added to Bookmarks');
        }

        // Save state to localstorage
        localStorage.setItem('bq_bookmarks', JSON.stringify(Array.from(state.bookmarks)));
        
        // Update statistics and re-render if we are in bookmarked filter mode
        updateStats();
        if (state.filters.type === 'bookmarked') {
            applyFiltersAndRender();
        }
    }

    // ==========================================================================
    // Clipboard Copy
    // ==========================================================================
    function copyToClipboard(update) {
        const textToCopy = `BigQuery Update [${update.type}] (${update.date}):\n${update.text_content}\n\nRead more: ${update.link}`;
        
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                showToast('Copied release notes to clipboard!');
            })
            .catch(err => {
                console.error('Could not copy text: ', err);
                showToast('Failed to copy text', true);
            });
    }

    // ==========================================================================
    // Tweet Composer Modal Operations
    // ==========================================================================
    
    // Auto templates for generating tweet compositions
    const tweetTemplates = [
        // Style 1: Professional & direct
        (type, date, text, link) => {
            const cleanText = truncate(text, 160);
            return `📢 BigQuery release note (${type}) • ${date}:\n\n${cleanText}\n\nFull details: ${link} #GoogleCloud #BigQuery`;
        },
        // Style 2: Analytics enthusiast
        (type, date, text, link) => {
            const cleanText = truncate(text, 140);
            return `🚀 Huge new ${type.toLowerCase()} in #BigQuery! (${date})\n\n"${cleanText}"\n\nCheck it out here: ${link} #GCP #DataAnalytics`;
        },
        // Style 3: Minimalist Developer
        (type, date, text, link) => {
            const cleanText = truncate(text, 190);
            return `💻 #BigQuery [${type}]: ${cleanText}\n\nDocs: ${link}`;
        }
    ];

    function openTweetModal(update) {
        state.currentTweetNote = update;
        state.tweetTemplateIndex = 0;
        
        // Show references in modal body
        elements.modalRefType.textContent = update.type;
        elements.modalRefType.className = `badge badge-${update.type.toLowerCase()}`;
        elements.modalRefDate.textContent = update.date;
        elements.modalRefText.textContent = update.text_content;

        // Set initial tweet textarea value using the first template
        generateTweetText();

        // Reveal modal
        elements.tweetModal.classList.remove('hidden');
        elements.tweetModal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden'; // Lock background scroll
        
        // Focus textarea
        elements.tweetTextarea.focus();
    }

    function generateTweetText() {
        if (!state.currentTweetNote) return;
        
        const note = state.currentTweetNote;
        const generator = tweetTemplates[state.tweetTemplateIndex];
        const tweetText = generator(note.type, note.date, note.text_content, note.link);
        
        elements.tweetTextarea.value = tweetText;
        updateCharCount();
    }

    function rotateTweetTemplates() {
        state.tweetTemplateIndex = (state.tweetTemplateIndex + 1) % tweetTemplates.length;
        generateTweetText();
        
        // Add a quick animation to suggest text refreshed
        elements.tweetTextarea.classList.add('animate-pulse');
        setTimeout(() => {
            elements.tweetTextarea.classList.remove('animate-pulse');
        }, 300);
        
        showToast('Switched tweet template style');
    }

    function updateCharCount() {
        const text = elements.tweetTextarea.value;
        const length = text.length;
        
        // Update counts
        elements.charCount.textContent = `${length} / ${CHAR_LIMIT}`;
        
        // Calculate percentages and rings
        const percentage = Math.min((length / CHAR_LIMIT) * 100, 100);
        const offset = RING_CIRCUMFERENCE - (percentage / 100) * RING_CIRCUMFERENCE;
        elements.charProgress.style.strokeDashoffset = offset;

        // Visual alerts based on character budget
        if (length === 0) {
            elements.btnSendTweet.disabled = true;
            elements.charWarning.classList.add('hidden');
            elements.charProgress.style.stroke = '#2563eb'; // blue
        } else if (length > CHAR_LIMIT) {
            elements.btnSendTweet.disabled = true;
            elements.charWarning.classList.remove('hidden');
            elements.charProgress.style.stroke = 'var(--color-issue)'; // red
            elements.charCount.style.color = 'var(--color-issue)';
        } else if (length >= CHAR_LIMIT - 30) {
            elements.btnSendTweet.disabled = false;
            elements.charWarning.classList.add('hidden');
            elements.charProgress.style.stroke = 'var(--color-deprecation)'; // orange/yellow
            elements.charCount.style.color = 'var(--color-deprecation)';
        } else {
            elements.btnSendTweet.disabled = false;
            elements.charWarning.classList.add('hidden');
            elements.charProgress.style.stroke = 'var(--color-primary)'; // default blue
            elements.charCount.style.color = 'var(--color-text-muted)';
        }
    }

    function performTweetAction() {
        const text = elements.tweetTextarea.value;
        if (text.length === 0 || text.length > CHAR_LIMIT) return;
        
        const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        
        // Open Web Intent in new tab
        window.open(twitterIntentUrl, '_blank', 'noopener,noreferrer');
        
        closeModal();
        showToast('Opened Twitter Intent window!');
    }

    function closeModal() {
        elements.tweetModal.classList.add('hidden');
        elements.tweetModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = ''; // Restore background scroll
        state.currentTweetNote = null;
    }

    // ==========================================================================
    // Utility Helper Functions
    // ==========================================================================
    function truncate(str, maxLen) {
        if (str.length <= maxLen) return str;
        return str.substr(0, maxLen - 3) + '...';
    }

    let toastTimeout = null;
    function showToast(message, isError = false) {
        if (toastTimeout) {
            clearTimeout(toastTimeout);
        }
        
        elements.toastMessage.textContent = message;
        elements.toast.classList.remove('hidden');
        
        const icon = elements.toast.querySelector('.toast-icon');
        if (isError) {
            icon.className = 'fa-solid fa-circle-exclamation';
            icon.style.color = 'var(--color-issue)';
            elements.toast.style.borderColor = 'var(--color-issue)';
        } else {
            icon.className = 'fa-solid fa-circle-check';
            icon.style.color = 'var(--color-feature)';
            elements.toast.style.borderColor = 'var(--color-primary)';
        }

        toastTimeout = setTimeout(() => {
            elements.toast.classList.add('hidden');
        }, 3000);
    }
});
