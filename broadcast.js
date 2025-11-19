/**
 * Retrieves all broadcasts from the currently loaded repository.
 * @returns {Array} An array of broadcast objects.
 */
function getBroadcasts() {
    if (window.currentRepository && window.currentRepository.appState && window.currentRepository.appState.broadcasts) {
        return window.currentRepository.appState.broadcasts;
    }
    return [];
}

/**
 * Saves all broadcasts to localStorage.
 * @param {Array} broadcasts - The array of broadcast objects to save.
 */
function saveRepositoryToSession() {
    if (window.currentRepository) {
        sessionStorage.setItem('currentRepository', JSON.stringify(window.currentRepository));
    } else {
        sessionStorage.removeItem('currentRepository');
    }
}

/**
 * Adds a new broadcast to the list.
 * @param {object} broadcastData - The broadcast data.
 * @param {string} broadcastData.title - The title of the broadcast.
 * @param {string} broadcastData.description - The description of the broadcast.
 * @param {string} broadcastData.type - The type of the broadcast (e.g., 'Information', 'Announcement').
 * @param {object} [broadcastData.examLink] - Optional link to a specific exam.
 */
function createBroadcast(broadcastData) {
    if (!window.currentRepository || !window.currentRepository.appState) {
        console.error("Cannot create broadcast: No repository loaded.");
        return null;
    }
    const newBroadcast = {
        id: `broadcast-${Date.now()}`,
        ...broadcastData,
        type: broadcastData.type || 'Information', // Default to 'Information'
        timestamp: new Date().toISOString(),
        archived: false,
    };
    // Add to the beginning of the array in the current repository
    window.currentRepository.appState.broadcasts.unshift(newBroadcast);
    return newBroadcast;
}

/**
 * Updates the archived status of a specific broadcast.
 * @param {string} broadcastId - The ID of the broadcast to update.
 * @param {boolean} isArchived - The new archived status.
 */
function updateBroadcastArchivedStatus(broadcastId, isArchived) {
    const broadcasts = getBroadcasts();
    const broadcastIndex = broadcasts.findIndex(b => b.id === broadcastId);
    if (broadcastIndex !== -1) {
        broadcasts[broadcastIndex].archived = isArchived;
        saveRepositoryToSession();
    }
}

/**
 * Updates the dismissed status of a specific broadcast.
 * @param {string} broadcastId - The ID of the broadcast to update.
 * @param {boolean} isDismissed - The new dismissed status.
 */
function updateBroadcastDismissedStatus(broadcastId, isDismissed) {
    const broadcasts = getBroadcasts();
    const broadcastIndex = broadcasts.findIndex(b => b.id === broadcastId);
    if (broadcastIndex !== -1) {
        broadcasts[broadcastIndex].dismissed = isDismissed;
        saveRepositoryToSession();
    }
}
/**
 * Renders a single broadcast item.
 * @param {object} broadcast - The broadcast object.
 * @param {boolean} isArchivedView - Whether this is being rendered in an archived list.
 * @returns {HTMLElement} The rendered broadcast element.
 */
function renderBroadcastItem(broadcast, isArchivedView = false) {
    const typeStyles = {
        'Information': {
            bg: 'bg-blue-50 dark:bg-blue-900/20',
            border: 'border-blue-400',
            titleText: 'text-blue-800 dark:text-blue-200',
            descText: 'text-blue-700 dark:text-blue-300'
        },
        'Announcement': {
            bg: 'bg-red-50 dark:bg-red-900/20',
            border: 'border-red-400',
            titleText: 'text-red-800 dark:text-red-200',
            descText: 'text-red-700 dark:text-red-300'
        },
        'Suggestion': {
            bg: 'bg-yellow-50 dark:bg-yellow-900/20',
            border: 'border-yellow-400',
            titleText: 'text-yellow-800 dark:text-yellow-200',
            descText: 'text-yellow-700 dark:text-yellow-300'
        },
        // Add other types like 'System' or 'Feature' here if needed
    };

    const style = typeStyles[broadcast.type] || typeStyles['Information'];
    const timeString = new Date(broadcast.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + new Date(broadcast.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    let description = broadcast.description;
    // If there's an exam link, add a clickable element to the description.
    if (broadcast.examLink) {
        const { student, question } = broadcast.examLink;
        const link = `grading.html?student=${encodeURIComponent(student)}&question=${encodeURIComponent(question)}`;
        description += `<br><a href="${link}" class="mt-2 inline-block text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"><span class="material-symbols-outlined text-sm align-middle">link</span> View Exam: ${student} - ${question}</a>`;
    }

    const actionButtons = isArchivedView
        ? `<button class="unarchive-btn px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">Unarchive</button>`
        : `<button class="dismiss-btn px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">Dismiss</button>
           <button class="archive-btn px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">Archive</button>`;


    const entry = document.createElement('div');
    entry.className = `${style.bg} border-l-4 ${style.border} p-4 rounded-lg shadow-sm`;
    entry.dataset.broadcastId = broadcast.id;
    entry.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <p class="text-sm font-semibold ${style.titleText}">${broadcast.title}</p>
            <span class="text-xs text-gray-500 dark:text-gray-400">${timeString}</span>
        </div>
        <p class="text-xs ${style.descText} mb-3">${description}</p>
        <div class="flex justify-end gap-2">
            ${actionButtons}
        </div>
    `;

    if (isArchivedView) {
        entry.querySelector('.unarchive-btn').addEventListener('click', () => {
            updateBroadcastArchivedStatus(broadcast.id, false);
            entry.remove(); // Remove from the archived view
        });
    } else {
        entry.querySelector('.dismiss-btn').addEventListener('click', () => {
            updateBroadcastDismissedStatus(broadcast.id, true);
            entry.remove(); // Remove from the live view
        });
        entry.querySelector('.archive-btn').addEventListener('click', () => {
            updateBroadcastArchivedStatus(broadcast.id, true);
            entry.remove(); // Remove from the live view
        });
    }

    return entry;
}

/**
 * Loads and displays all broadcasts in a given list container.
 * @param {HTMLElement} feedListElement - The container element for the feed.
 * @param {boolean} showArchived - Whether to show archived items instead of live ones.
 */
function loadAndDisplayBroadcasts(feedListElement, showArchived = false) {
    if (!feedListElement) return;

    const broadcasts = getBroadcasts();
    const filteredBroadcasts = broadcasts.filter(b => b.archived === showArchived && !b.dismissed);

    // Clear current list, but keep placeholder if it exists
    const placeholder = feedListElement.querySelector('.text-center');
    feedListElement.innerHTML = '';
    if (placeholder) {
        feedListElement.appendChild(placeholder);
    }

    if (filteredBroadcasts.length > 0) {
        if (placeholder) placeholder.style.display = 'none';
        filteredBroadcasts.forEach(broadcast => {
            const item = renderBroadcastItem(broadcast, showArchived);
            feedListElement.prepend(item);
        });
    } else {
        if (placeholder) placeholder.style.display = 'block';
    }
}