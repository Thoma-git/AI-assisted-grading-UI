/**
 * Renders the grading progress doughnut chart.
 * 
 * @param {Object} progressData - Object containing grading statistics (aiHigh, aiLow, lowScore, gradedOnce, graded2Plus).
 * @param {string} containerId - The ID of the container element (default: 'grading-progress-container').
 */
export function renderGradingProgress(progressData, containerId = 'grading-progress-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const chart = container.querySelector('.donut-chart');
    const centerText = container.querySelector('.donut-chart-center-text');
    const subText = container.querySelector('.donut-chart-subtext');

    if (!progressData) {
        // Handle empty state
        if (centerText) centerText.textContent = 'N/A';
        if (subText) subText.textContent = 'No data';
        return;
    }

    const { aiHigh, aiLow, lowScore, gradedOnce, graded2Plus } = progressData;

    // Calculate cumulative percentages
    // Order: AI High (Blue) -> AI Low (Light Blue) -> Low AI Score (Red) -> Graded Once (Light Green) -> Graded 2+ (Dark Green)
    const p1 = aiHigh;
    const p2 = p1 + aiLow;
    const p3 = p2 + lowScore;
    const p4 = p3 + gradedOnce;

    // Check if SVG exists, if not create it
    let svg = chart.querySelector('svg.donut-svg');
    if (!svg) {
        // Remove background style from chart div
        chart.style.background = 'none';

        // Create SVG
        // r=15.9155 makes circumference approx 100, simplifying dasharray calculations
        // Stroke width calculated to match visual thickness (approx 1/6 of diameter)
        const r = 15.9155;
        const sw = 6.3662; // r / 2.5

        chart.innerHTML = `
            <svg class="donut-svg absolute top-0 left-0 w-full h-full transform -rotate-90" viewBox="0 0 40 40">
                <style>
                    .donut-segment { transition: stroke-dasharray 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
                </style>
                <!-- Background / Graded 2+ (Dark Green) -->
                <circle cx="20" cy="20" r="${r}" fill="none" stroke="#22C55E" stroke-width="${sw}" stroke-dasharray="100 100"></circle>
                
                <!-- Graded Once (Light Green) -->
                <circle class="donut-segment segment-graded-once" cx="20" cy="20" r="${r}" fill="none" stroke="#86EFAC" stroke-width="${sw}" stroke-dasharray="0 100"></circle>
                
                <!-- Low AI Score (Red) -->
                <circle class="donut-segment segment-low-score" cx="20" cy="20" r="${r}" fill="none" stroke="#EF4444" stroke-width="${sw}" stroke-dasharray="0 100"></circle>
                
                <!-- AI Low (Light Blue) -->
                <circle class="donut-segment segment-ai-low" cx="20" cy="20" r="${r}" fill="none" stroke="#60A5FA" stroke-width="${sw}" stroke-dasharray="0 100"></circle>
                
                <!-- AI High (Blue) -->
                <circle class="donut-segment segment-ai-high" cx="20" cy="20" r="${r}" fill="none" stroke="#3B82F6" stroke-width="${sw}" stroke-dasharray="0 100"></circle>
            </svg>
        `;

        // Re-select elements after innerHTML update
        svg = chart.querySelector('svg.donut-svg');
    }

    // Re-query center text because we might have replaced the innerHTML
    // Note: In the previous fix, we removed the text elements from the template so they persist.
    // We query them again just to be safe and consistent.
    const currentCenterText = container.querySelector('.donut-chart-center-text');
    const currentSubText = container.querySelector('.donut-chart-subtext');

    // Update Segments
    // Note: stroke-dasharray="LENGTH GAP"
    // We use cumulative lengths for the stacking effect

    const setSegment = (cls, val) => {
        const el = chart.querySelector(`.${cls}`);
        if (el) el.setAttribute('stroke-dasharray', `${Math.max(0, val)} 100`);
    };

    setSegment('segment-graded-once', p4);
    setSegment('segment-low-score', p3);
    setSegment('segment-ai-low', p2);
    setSegment('segment-ai-high', p1);

    const manuallyGradedTotal = gradedOnce + graded2Plus;
    if (currentCenterText) currentCenterText.textContent = `${Math.round(manuallyGradedTotal)}%`;
    if (currentSubText) currentSubText.textContent = 'manually graded';
}

/**
 * Renders the question breakdown progress bars.
 * 
 * @param {Array} questions - List of question objects.
 * @param {Object} questionStats - Object containing stats for each question.
 * @param {string} containerId - The ID of the container element (default: 'question-breakdown-container').
 */
export function renderQuestionBreakdown(questions, questionStats, containerId = 'question-breakdown-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!questions || questions.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 p-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg">Select a repository to view question breakdown.</div>`;
        return;
    }

    // Clear empty state message if present
    const emptyStateMsg = container.querySelector('.text-center');
    if (emptyStateMsg && emptyStateMsg.textContent.includes('Select a repository')) {
        container.innerHTML = '';
    }

    // Helper to update or create a single bar
    const updateOrCreateBar = (id, label, stats) => {
        let card = document.getElementById(`question-card-${id}`);

        // Order: AI High (Blue) -> AI Low (Light Blue) -> Low Score (Red) -> Graded Once (Light Green) -> Graded 2+ (Dark Green)
        const aiHighWidth = stats.aiHigh;
        const aiLowWidth = stats.aiLow;
        const lowScoreWidth = stats.lowScore;
        const gradedOnceWidth = stats.gradedOnce;
        const graded2PlusWidth = stats.graded2Plus;

        if (!card) {
            card = document.createElement('div');
            card.id = `question-card-${id}`;
            card.className = 'flex flex-col question-card mb-3';
            card.innerHTML = `
                <div class="flex justify-between items-center mb-1">
                    <span class="text-base font-medium text-gray-800 dark:text-gray-200">${label}</span>
                    <span class="text-sm text-gray-500 dark:text-gray-400 font-semibold stats-text"></span>
                </div>
                <div class="progress-bar-wrapper flex h-2.5 w-full bg-gray-200 rounded-full overflow-hidden dark:bg-gray-700">
                    <div class="bar-ai-high" style="background-color: #3B82F6; transition: width 0.3s ease;"></div>
                    <div class="bar-ai-low" style="background-color: #60A5FA; transition: width 0.3s ease;"></div>
                    <div class="bar-low-score" style="background-color: #EF4444; transition: width 0.3s ease;"></div>
                    <div class="bar-graded-once" style="background-color: #86EFAC; transition: width 0.3s ease;"></div>
                    <div class="bar-graded-2plus" style="background-color: #22C55E; transition: width 0.3s ease;"></div>
                </div>`;
            container.appendChild(card);
        }

        // Update values
        card.querySelector('.stats-text').textContent = `${Math.round(stats.aiHigh + stats.lowScore + stats.aiLow)}% AI / ${Math.round(stats.gradedOnce + stats.graded2Plus)}% Manual`;

        const setBar = (cls, width, title) => {
            const el = card.querySelector(`.${cls}`);
            el.style.width = `${width}%`;
            el.title = title;
        };

        setBar('bar-ai-high', aiHighWidth, `AI Conf >= Threshold: ${Math.round(aiHighWidth)}%`);
        setBar('bar-ai-low', aiLowWidth, `AI Conf < Threshold: ${Math.round(aiLowWidth)}%`);
        setBar('bar-low-score', lowScoreWidth, `Low AI Score: ${Math.round(lowScoreWidth)}%`);
        setBar('bar-graded-once', gradedOnceWidth, `Graded Once: ${Math.round(gradedOnceWidth)}%`);
        setBar('bar-graded-2plus', graded2PlusWidth, `Graded 2+ times: ${Math.round(graded2PlusWidth)}%`);
    };

    questions.forEach(q => {
        // Logic is now aggregated in grading-logic.js, so we only render top-level questions
        const stats = questionStats[q.id] || { aiHigh: 0, aiLow: 0, lowScore: 0, gradedOnce: 0, graded2Plus: 0 };
        updateOrCreateBar(q.id, q.name, stats);
    });
}
