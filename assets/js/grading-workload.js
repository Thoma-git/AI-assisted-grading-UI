/**
 * Initializes the TA Workload section.
 * @param {Object} repository - The exam repository.
 */
export function initializeTaWorkload(repository) {
    const workloadContainer = document.getElementById('assigned-workload-container');
    if (!workloadContainer) return;

    const workloadHeader = workloadContainer.previousElementSibling;

    // Create TA Selector if it doesn't exist
    if (!document.getElementById('ta-selector')) {
        const taSelectorContainer = document.createElement('div');
        taSelectorContainer.className = 'ml-auto';
        taSelectorContainer.innerHTML = `
            <select id="ta-selector" class="text-xs bg-gray-100 dark:bg-gray-700 border-none rounded px-2 py-1 text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-primary cursor-pointer">
                <!-- Options will be populated dynamically -->
            </select>
        `;
        workloadHeader.appendChild(taSelectorContainer);

        const taSelector = document.getElementById('ta-selector');
        taSelector.addEventListener('change', (e) => {
            renderAssignedWorkload(e.target.value, repository);
        });
    }

    // Populate TA Selector
    const taSelector = document.getElementById('ta-selector');
    taSelector.innerHTML = '';

    if (!repository || !repository.appState || !repository.appState.taskAllocation || !repository.appState.taskAllocation.tas) {
        workloadContainer.innerHTML = '<p class="col-span-2 text-sm text-gray-500 dark:text-gray-400">No TA data available.</p>';
        return;
    }

    const tas = repository.appState.taskAllocation.tas;
    tas.forEach(ta => {
        const option = document.createElement('option');
        option.value = ta.id;
        option.textContent = ta.name;
        taSelector.appendChild(option);
    });

    // Default to first TA or previously selected
    if (tas.length > 0) {
        renderAssignedWorkload(tas[0].id, repository);
    }
}

/**
 * Renders the assigned workload for a specific TA.
 * @param {string} taId - The ID of the TA.
 * @param {Object} repository - The exam repository.
 */
export function renderAssignedWorkload(taId, repository) {
    const workloadContainer = document.getElementById('assigned-workload-container');
    workloadContainer.innerHTML = '';

    const ta = repository.appState.taskAllocation.tas.find(t => t.id === taId);
    if (!ta || !ta.tasks || ta.tasks.length === 0) {
        workloadContainer.innerHTML = '<p class="col-span-2 text-sm text-gray-500 dark:text-gray-400">No tasks assigned.</p>';
        return;
    }

    ta.tasks.forEach(task => {
        const taskItem = document.createElement('div');
        // Improved styling:
        // - Removed 'bg-gray-50' and 'dark:bg-gray-700/30' which might have been causing the "white box" issue if not handled well.
        // - Added 'bg-white' for light mode and 'dark:bg-gray-800' for dark mode with a border.
        // - Actually, the user said "white box which is even too bright".
        // - Let's use a softer background.
        taskItem.className = 'p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 cursor-pointer hover:border-primary dark:hover:border-primary transition-all duration-200 flex items-center justify-between group';

        // Determine display name (Q1, Q1.A, etc.)
        let displayName = task.taskId;
        const question = repository.questions.find(q => q.id === task.taskId);
        // Check if it's a subquestion
        if (!question) {
            // Might be a subquestion
            for (const q of repository.questions) {
                if (q.subquestions) {
                    const sub = q.subquestions.find(sq => sq.id === task.taskId);
                    if (sub) {
                        displayName = sub.name; // Use the name like "Q1.A"
                        break;
                    }
                }
            }
        } else {
            displayName = question.id;
        }

        // Add version badge with extended text
        const versionText = task.version === 'first' ? '1st Rev' : '2nd Rev';
        const versionBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 ml-2 whitespace-nowrap">${versionText}</span>`;

        taskItem.innerHTML = `
            <span class="font-medium text-gray-700 dark:text-gray-200 text-sm truncate">${displayName}</span>
            ${versionBadge}
        `;

        taskItem.addEventListener('click', () => {
            // Remove active state from all others
            workloadContainer.querySelectorAll('div').forEach(el => {
                el.classList.remove('ring-2', 'ring-primary', 'bg-primary/10', 'dark:bg-primary/20');
                // Re-add default bg
                el.classList.add('bg-gray-50', 'dark:bg-gray-700/40');
            });
            // Add active state to clicked
            taskItem.classList.remove('bg-gray-50', 'dark:bg-gray-700/40');
            taskItem.classList.add('ring-2', 'ring-primary', 'bg-primary/10', 'dark:bg-primary/20');

            // Apply Filter
            applyWorkloadFilter(task.taskId);
        });

        workloadContainer.appendChild(taskItem);
    });
}

/**
 * Applies the filter based on the selected workload task.
 * @param {string} taskId - The task ID (question ID).
 */
function applyWorkloadFilter(taskId) {
    const questionFilter = document.getElementById('question-filter');
    const studentFilter = document.getElementById('student-filter');

    // Reset student filter
    studentFilter.value = "";

    let optionFound = false;
    // First try exact match
    for (let i = 0; i < questionFilter.options.length; i++) {
        if (questionFilter.options[i].value === taskId) {
            questionFilter.selectedIndex = i;
            optionFound = true;
            break;
        }
    }

    // If not found (maybe it's a subquestion but filter only has parents, or vice versa)
    if (!optionFound) {
        // Try finding the parent ID if this is a subquestion
        const parentId = taskId.split('.')[0];
        for (let i = 0; i < questionFilter.options.length; i++) {
            if (questionFilter.options[i].value === parentId) {
                questionFilter.selectedIndex = i;
                optionFound = true;
                break;
            }
        }
    }

    if (optionFound) {
        // Trigger change event to update the list
        questionFilter.dispatchEvent(new Event('change'));
    } else {
        console.warn(`[Grading] Could not find filter option for task: ${taskId}`);
    }
}
