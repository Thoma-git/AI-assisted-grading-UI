import { updateManualGradingStatus } from './grading-exams-list.js';

// --- State Management ---
let currentStudent = null;
let currentQuestionId = null;
let checkpoints = [];
let isDragging = false;
let draggedElement = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

// --- Constants ---
const STICKY_BOTTOM_OFFSET = 20;
const PAGE_MARGIN = 16;

/**
 * Initializes the grading view module.
 */
export function initializeGradingView() {
    injectStyles();
    setupGlobalEventListeners();
    setupSmartRendering();
    setupComments();
    setupFinalizeButtonListener();
}

/**
 * Helper: Injects CSS to hide standard number input spinners
 */
function injectStyles() {
    if (document.getElementById('grading-view-styles')) return;
    const style = document.createElement('style');
    style.id = 'grading-view-styles';
    style.innerHTML = `
        input[type=number]::-webkit-inner-spin-button, 
        input[type=number]::-webkit-outer-spin-button { 
            -webkit-appearance: none; 
            margin: 0; 
        }
        input[type=number] {
            -moz-appearance: textfield;
        }
    `;
    document.head.appendChild(style);
}

export async function loadStudentExam(student, questionId) {
    if (!student || !questionId) return;

    currentStudent = student;
    currentQuestionId = questionId;

    const examTitle = document.getElementById('exam-title');
    if (examTitle) examTitle.textContent = `${student.name} (${questionId})`;

    // Reset the container
    document.getElementById('grading-panel').innerHTML = '<div id="pdf-page-container" class="relative min-h-full w-full flex flex-col items-center pb-32"><div id="grading-overlay-container" class="absolute inset-0 pointer-events-none z-10"></div></div>';

    const pdfUrl = student.url || 'assets/exams/dummy-exam.pdf';

    // --- PAGE NUMBER LOGIC ---
    let pageNumber = null;
    if (window.currentRepository) {
        const repo = window.currentRepository;
        const findQuestion = (questions, id) => {
            for (const q of questions) {
                if (q.id === id) return q;
                if (q.subquestions) {
                    const sub = q.subquestions.find(s => s.id === id);
                    if (sub) return sub;
                }
            }
            return null;
        };

        const qData = findQuestion(repo.questions, questionId);
        if (qData && qData.pages) {
            pageNumber = String(qData.pages).split('-')[0].trim();
        } else {
            const parent = repo.questions.find(q => q.subquestions?.some(sq => sq.id === questionId));
            if (parent && parent.pages) {
                pageNumber = String(parent.pages).split('-')[0].trim();
            }
        }
    }

    console.log(`[GradingView] loadStudentExam called for ${student.name}, ${questionId}`);
    console.trace("[GradingView] Trace for loadStudentExam call:");

    // Initialize viewer
    const success = await window.initializePdfViewer(pdfUrl, pageNumber);
    if (!success) {
        console.log(`[GradingView] PDF initialization cancelled or failed for ${questionId}. Aborting checkpoint render.`);
        return;
    }

    // Render UI elements
    renderGradingCheckpoints(questionId);
    renderComments(student.id, questionId);
    setupNavigationCircles(questionId);

    // Trigger Rubric Load if tab is active
    const rubricTabBtn = document.getElementById('rubric-tab-btn');
    if (rubricTabBtn && rubricTabBtn.classList.contains('text-primary') && window.initializeRubricViewer) {
        window.initializeRubricViewer();
    }

    // Update totals immediately after render
    updateTotalScoreDisplay();
}

/**
 * Renders grading checkpoints.
 */
function renderGradingCheckpoints(questionId) {
    const container = document.getElementById('grading-overlay-container');
    if (!container) return;

    container.innerHTML = '';
    checkpoints = [];

    const repo = window.currentRepository;
    let relevantCheckpoints = [];

    // 1. Determine if we are looking at a Parent Question or a Subquestion/Standalone
    const parentQuestion = repo.questions.find(q => q.id === questionId);

    if (parentQuestion && parentQuestion.subquestions && parentQuestion.subquestions.length > 0) {
        // CASE A: Parent Question -> Show ALL subquestion checkpoints
        console.log(`[GradingView] Question ${questionId} is a parent. Gathering subquestion checkpoints...`);
        parentQuestion.subquestions.forEach(sub => {
            const subCheckpoints = repo.gradingCheckpoints.filter(cp => cp.questionId === sub.id);
            relevantCheckpoints.push(...subCheckpoints);
        });
    } else {
        // CASE B: Subquestion or Standalone -> Show ONLY this question's checkpoints
        // (No fallback to siblings!)
        relevantCheckpoints = repo.gradingCheckpoints.filter(cp => cp.questionId === questionId);
    }

    console.log(`[GradingView] Rendering checkpoints for ${questionId}. Found ${relevantCheckpoints.length} checkpoints.`);
    const wrappers = document.querySelectorAll('.page-wrapper');
    console.log(`[GradingView] Found ${wrappers.length} page wrappers in DOM.`);
    wrappers.forEach(w => console.log(`[GradingView] Wrapper: Page ${w.getAttribute('data-page-number')}`));



    relevantCheckpoints.forEach((cp, index) => {
        // Calculate Max Points for this specific checkpoint
        let maxPoints = 0;
        const cpQId = cp.questionId;

        // Try to find as top-level question
        const qTop = repo.questions.find(q => q.id === cpQId);
        if (qTop) {
            maxPoints = qTop.points || 0;
        } else {
            // Try to find as subquestion
            const qParent = repo.questions.find(q => q.subquestions?.some(sq => sq.id === cpQId));
            if (qParent) {
                const qSub = qParent.subquestions.find(sq => sq.id === cpQId);
                maxPoints = qSub ? (qSub.points || 0) : 0;
            }
        }
        if (!maxPoints) maxPoints = 5; // Fallback
        const gradeEntry = currentStudent.grades?.find(g => g.questionId === cp.questionId) || {}; // Use cp.questionId specifically
        const aiConfidence = gradeEntry.confidence || 0;
        const aiSuggestedPoints = gradeEntry.aiSuggestedScore || 0;
        const currentScore = gradeEntry.score;
        const aiComment = gradeEntry.comment || '';

        let pillBg = 'rgba(239, 68, 68, 0.2)'; let pillText = '#f87171';
        if (aiConfidence > 80) { pillBg = 'rgba(16, 185, 129, 0.2)'; pillText = '#34d399'; }
        else if (aiConfidence > 50) { pillBg = 'rgba(251, 191, 36, 0.2)'; pillText = '#fbbf24'; }

        // Find the target page wrapper
        let targetPage = cp.page || 1;
        let pageWrapper = document.querySelector(`.page-wrapper[data-page-number="${targetPage}"]`);

        // Fallback: If target page doesn't exist, use the last available page
        let isFallback = false;
        if (!pageWrapper) {
            const allWrappers = document.querySelectorAll('.page-wrapper');
            if (allWrappers.length > 0) {
                pageWrapper = allWrappers[allWrappers.length - 1];
                isFallback = true;
            } else {
                return;
            }
        }

        const pageOverlay = pageWrapper.querySelector('.page-overlay');
        if (!pageOverlay) return;

        console.log(`[GradingView] Rendering checkpoint ${index + 1} on page ${targetPage} at ${cp.position.x}, ${cp.position.y}`);

        const el = document.createElement('div');
        el.id = `source${index + 1}`;
        el.className = 'absolute group bg-[#1e293b] rounded-lg shadow-lg pointer-events-auto select-none flex flex-col transition-transform transform-gpu';

        // Use direct positioning (percentages) with centered anchor
        el.style.cssText = `
            width: 620px; 
            max-width: 95%; 
            left: ${cp.position.x}; 
            top: ${cp.position.y};
            transform: translate(-50%, -50%); 
            border: 1px solid ${isFallback ? '#f59e0b' : '#374151'};
            z-index: 50;
        `;

        // Add Fallback Warning if needed
        let fallbackBanner = '';
        if (isFallback) {
            fallbackBanner = `
                <div class="bg-amber-500/20 text-amber-500 text-xs font-bold px-3 py-1 border-b border-amber-500/30 flex items-center justify-center">
                    <span class="material-symbols-outlined text-sm mr-1">warning</span>
                    Page ${targetPage} not found. Shown on Page ${pageWrapper.getAttribute('data-page-number')}.
                </div>
            `;
        }

        // IMPORTANT: The input calls window.handleScoreChange with this checkpoint's specific ID
        el.innerHTML = `
            ${fallbackBanner}
            <div class="flex items-center h-[50px] w-full bg-[#1e293b] rounded-lg overflow-hidden shadow-md border border-gray-700 select-none">
                <div class="h-full flex items-center px-3 bg-gray-800/50 border-r border-gray-700 cursor-move handle hover:bg-gray-700/50 transition-colors flex-shrink-0">
                    <span class="material-symbols-outlined text-gray-500 text-lg mr-2">drag_indicator</span>
                    <span class="font-bold text-sm text-gray-200 whitespace-nowrap">Checkpoint ${index + 1}</span>
                </div>
                <div class="flex-1 flex items-center justify-between px-4 gap-4 min-w-0 overflow-hidden">
                    <div class="flex items-center gap-3 flex-shrink-0">
                        <span style="background: ${pillBg}; color: ${pillText};" class="px-2 py-0.5 rounded text-[10px] font-bold border border-white/5 whitespace-nowrap uppercase tracking-wide">
                            ${aiConfidence}% Conf.
                        </span>
                        <div class="w-px h-4 bg-gray-600/50"></div>
                        <div class="flex items-baseline gap-2 whitespace-nowrap">
                             <span class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">AI Sugg.</span>
                             <span class="text-sm font-bold text-gray-100">${aiSuggestedPoints} / ${maxPoints}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 flex-shrink-0">
                        <div class="w-px h-4 bg-gray-600/50"></div>
                        <div class="flex items-center gap-2 whitespace-nowrap">
                            <span class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Grade</span>
                            <div class="relative flex items-center bg-gray-900/50 border border-gray-600 rounded px-2 py-0.5 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/30 transition-all">
                                <input type="number" min="0" max="${maxPoints}" 
                                    class="bg-transparent text-white font-bold text-center focus:outline-none p-0 w-7 text-sm"
                                    value="${currentScore !== null && currentScore !== undefined ? currentScore : ''}"
                                    oninput="handleScoreChange(this, '${cp.questionId}')"
                                    placeholder="-"
                                >
                                <span class="text-[10px] text-gray-500 ml-0.5 font-medium select-none">/${maxPoints}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="h-full flex items-center px-2 gap-1 border-l border-gray-700 bg-gray-800/50 flex-shrink-0">
                    <button class="comment-toggle-btn w-8 h-8 rounded text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 transition-all flex items-center justify-center" title="Toggle Comment">
                        <span class="material-symbols-outlined text-[18px]">chat_bubble</span>
                    </button>
                    <button class="rubric-scroll-btn w-8 h-8 rounded text-gray-400 hover:text-orange-400 hover:bg-orange-400/10 transition-all flex items-center justify-center" title="Scroll to Rubric">
                        <span class="material-symbols-outlined text-[18px]">menu_book</span>
                    </button>
                </div>
            </div>
            <div class="comment-body hidden w-full bg-[#1e293b] border-t border-gray-700 rounded-b-lg p-3 shadow-inner relative z-50">
                <textarea class="w-full bg-[#0f172a] text-gray-200 text-sm p-2 rounded border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none resize-y min-h-[60px]" 
                placeholder="Add a comment...">${aiComment}</textarea>
            </div>
        `;

        pageOverlay.appendChild(el);
        checkpoints.push({ data: cp, element: el });

        // --- Event Listeners ---
        const handle = el.querySelector('.handle');
        handle.addEventListener('mousedown', (e) => startDrag(e, el, cp));

        const toggleBtn = el.querySelector('.comment-toggle-btn');
        const commentBody = el.querySelector('.comment-body');
        const textArea = el.querySelector('textarea');

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = commentBody.classList.contains('hidden');
            if (isHidden) {
                commentBody.classList.remove('hidden');
                toggleBtn.classList.add('text-blue-400', 'bg-blue-500/10');
                el.querySelector('.rounded-tl-lg').classList.remove('rounded-bl-lg');
            } else {
                commentBody.classList.add('hidden');
                toggleBtn.classList.remove('text-blue-400', 'bg-blue-500/10');
                toggleBtn.classList.remove('text-blue-400', 'bg-blue-500/10');
            }
        });

        textArea.addEventListener('input', (e) => {
            if (currentStudent && currentStudent.grades) {
                let g = currentStudent.grades.find(x => x.questionId === cp.questionId);
                if (!g) {
                    g = { questionId: cp.questionId, confidence: 0, aiSuggestedScore: 0, score: null };
                    currentStudent.grades.push(g);
                }
                g.comment = e.target.value;
                saveRepositoryState();
            }
        });

        textArea.addEventListener('mousedown', (e) => e.stopPropagation());


    });
}

function startDrag(e, el, checkpointData) {
    e.preventDefault();
    isDragging = true;
    draggedElement = el;

    const rect = el.getBoundingClientRect();
    // Use the parent (page-overlay) for relative calculations
    const overlayContainer = el.parentElement;
    const containerRect = overlayContainer.getBoundingClientRect();

    const currentVisualLeft = rect.left - containerRect.left;
    el.style.transform = 'none';
    el.style.left = `${currentVisualLeft}px`;

    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

    const onDrag = (e) => {
        if (!isDragging || !draggedElement) return;
        e.preventDefault();

        let newLeft = e.clientX - containerRect.left - dragOffsetX;
        let newTop = e.clientY - containerRect.top - dragOffsetY;

        if (newLeft < 0) newLeft = 0;
        if (newLeft + el.offsetWidth > containerRect.width) newLeft = containerRect.width - el.offsetWidth;
        if (newTop < 0) newTop = 0;
        if (newTop + el.offsetHeight > containerRect.height) newTop = containerRect.height - el.offsetHeight;

        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;

        // Update data model with percentages (Save CENTER position)
        const centerX = newLeft + el.offsetWidth / 2;
        const centerY = newTop + el.offsetHeight / 2;

        checkpointData.position.x = `${(centerX / containerRect.width) * 100}%`;
        checkpointData.position.y = `${(centerY / containerRect.height) * 100}%`;
    };

    const stopDrag = () => {
        isDragging = false;
        draggedElement = null;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    };

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
}

function setupSmartRendering() {
    // No longer needed
}

function updateCheckpointPositions() {
    // No longer needed
}

function setupGlobalEventListeners() {
    const panel = document.getElementById('grading-panel');
    if (panel) {
        panel.addEventListener('scroll', () => {
            requestAnimationFrame(updateStickyCheckpoints);
        });
    }
    window.addEventListener('resize', () => {
        requestAnimationFrame(updateStickyCheckpoints);
    });
}

function updateStickyCheckpoints() {
    const panel = document.getElementById('grading-panel');
    if (!panel || checkpoints.length === 0) return;

    const panelRect = panel.getBoundingClientRect();
    const STICKY_OFFSET = 20; // Distance from bottom
    const OVERLAP_PADDING = 10; // Min distance from previous element

    // 1. Calculate screen positions for all checkpoints based on their PAGE
    const checkpointsWithPos = checkpoints.map(cp => {
        const pageNum = cp.data.page || 1;
        const pageWrapper = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"]`);

        if (!pageWrapper) {
            return null;
        }

        const pageRect = pageWrapper.getBoundingClientRect();
        const naturalYPercent = parseFloat(cp.data.position.y);
        const naturalYPixelsInPage = (naturalYPercent / 100) * pageRect.height;

        // Screen Y of the center of the element
        const elHeight = cp.element.offsetHeight;
        const naturalTopScreen = pageRect.top + naturalYPixelsInPage - (elHeight / 2);

        return { ...cp, naturalTopScreen, elHeight, pageRect };
    }).filter(cp => cp !== null)
        .sort((a, b) => a.naturalTopScreen - b.naturalTopScreen);

    // 2. Find the first candidate that is strictly below the viewport
    let stickyCandidate = null;
    let prevCheckpoint = null;

    for (let i = 0; i < checkpointsWithPos.length; i++) {
        const cp = checkpointsWithPos[i];

        // Check if this checkpoint is completely below the visible panel area
        if (cp.naturalTopScreen > panelRect.bottom + 5) {
            stickyCandidate = cp;
            if (i > 0) {
                prevCheckpoint = checkpointsWithPos[i - 1];
            }
            break;
        }
    }

    // 3. Reset ALL checkpoints first to ensure clean state
    checkpoints.forEach(cp => {
        cp.element.style.position = 'absolute';
        cp.element.style.top = cp.data.position.y;
        cp.element.style.left = cp.data.position.x;
        // Default transform
        cp.element.style.transform = 'translate(-50%, -50%)';
        cp.element.style.zIndex = '50';
        cp.element.style.width = '620px';
        // Ensure no transition lag during scroll
        cp.element.style.transition = 'none';
    });

    // 4. Apply Sticky Logic if Candidate Found
    if (stickyCandidate) {
        let shouldStick = true;

        // Overlap Prevention
        if (prevCheckpoint) {
            const prevRect = prevCheckpoint.element.getBoundingClientRect();
            const prevBottomScreen = prevRect.bottom;

            // Calculate where the sticky top would be
            // Sticky Bottom Edge = panelRect.bottom - STICKY_OFFSET
            // Sticky Top Edge = Sticky Bottom Edge - stickyCandidate.element.offsetHeight
            const stickyTopScreen = panelRect.bottom - STICKY_OFFSET - stickyCandidate.elHeight;

            if (stickyTopScreen < prevBottomScreen + OVERLAP_PADDING) {
                shouldStick = false;
            }
        }

        if (shouldStick) {
            const el = stickyCandidate.element;

            // Calculate deltaY to shift the element to the bottom
            // Target Bottom = panelRect.bottom - STICKY_OFFSET
            // Natural Bottom = stickyCandidate.naturalTopScreen + stickyCandidate.elHeight
            // deltaY = Target Bottom - Natural Bottom

            const targetBottom = panelRect.bottom - STICKY_OFFSET;
            const naturalBottom = stickyCandidate.naturalTopScreen + stickyCandidate.elHeight;
            const deltaY = targetBottom - naturalBottom;

            // Apply transform
            // We keep the -50% X translation, and add deltaY to the Y translation
            // The original Y translation is -50%. We need to add deltaY pixels.
            // Since we can't easily mix % and px in translate(x, y) without calc, we use calc.

            el.style.transform = `translate(-50%, calc(-50% + ${deltaY}px))`;
            el.style.zIndex = '100';
        }
    }
}

// --- GLOBAL HANDLER FOR INPUTS ---
window.handleScoreChange = function (input, qId) {
    const val = input.value.trim();

    if (currentStudent && currentStudent.grades) {
        // Find or create the grade entry for the specific checkpoint/question
        let gradeEntry = currentStudent.grades.find(g => g.questionId === qId);
        if (!gradeEntry) {
            gradeEntry = { questionId: qId, confidence: 0, aiSuggestedScore: 0 };
            currentStudent.grades.push(gradeEntry);
        }
        gradeEntry.score = (val === '') ? null : parseInt(val);
        saveRepositoryState();
    }

    // TRIGGER UI UPDATE
    updateTotalScoreDisplay();
    updateNavigationCircleStatus(qId, val !== '');
};

function saveRepositoryState() {
    if (window.currentRepository) {
        sessionStorage.setItem('currentRepository', JSON.stringify(window.currentRepository));
    }
}

function setupNavigationCircles(questionId) {
    const container = document.getElementById('grading-checkpoints');
    if (!container) return;
    container.innerHTML = '';

    checkpoints.forEach((cp, index) => {
        const circle = document.createElement('div');
        const score = getStudentScore(cp.data.questionId);
        const isScored = score !== null && score !== undefined && score !== '';

        const baseClass = "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200 cursor-pointer select-none border-2";

        if (isScored) {
            circle.className = `${baseClass} bg-emerald-500 border-emerald-600 text-white shadow-sm`;
        } else {
            circle.className = `${baseClass} bg-transparent border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-500 hover:text-blue-500`;
        }

        circle.textContent = index + 1;
        circle.onclick = () => scrollToCheckpoint(index);
        container.appendChild(circle);
    });
}

function scrollToCheckpoint(index) {
    const cp = checkpoints[index];
    if (!cp) return;
    const panel = document.getElementById('grading-panel');

    // Calculate the NATURAL position to scroll to
    const pageNum = cp.data.page || 1;
    const pageWrapper = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"]`);

    if (pageWrapper && panel) {
        const naturalYPercent = parseFloat(cp.data.position.y);
        const naturalYPixels = (naturalYPercent / 100) * pageWrapper.offsetHeight;

        // Calculate the absolute top position of the target point within the scrollable container
        // We assume pageWrapper is inside the scrollable panel
        const pageTop = pageWrapper.offsetTop;
        const targetTop = pageTop + naturalYPixels;

        // Center the target in the panel
        const scrollTarget = targetTop - (panel.clientHeight / 2);

        panel.scrollTo({
            top: scrollTarget,
            behavior: 'smooth'
        });
    } else {
        // Fallback if page wrapper not found (shouldn't happen if rendered)
        cp.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function updateNavigationCircleStatus(qId, isScored) {
    setupNavigationCircles(currentQuestionId);
}

function getStudentScore(qId) {
    if (!currentStudent || !currentStudent.grades) return null;
    const g = currentStudent.grades.find(g => g.questionId === qId);
    return g ? g.score : null;
}

// --- UPDATED SCORE LOGIC ---
function updateTotalScoreDisplay() {
    if (!currentStudent) return;

    // 1. Calculate Max Points (for display)
    // 1. Calculate Max Points (for display)
    const repo = window.currentRepository;

    // Find Question Data
    const findQuestion = (questions, id) => {
        for (const q of questions) {
            if (q.id === id) return q;
            if (q.subquestions) {
                const subQ = q.subquestions.find(sub => sub.id === id);
                if (subQ) return subQ;
            }
        }
        return null;
    };

    const questionData = findQuestion(repo.questions, currentQuestionId);
    let maxTotal = 0;

    if (questionData) {
        if (questionData.points) {
            maxTotal = questionData.points;
        } else if (questionData.subquestions) {
            maxTotal = questionData.subquestions.reduce((acc, curr) => acc + (curr.points || 0), 0);
        }
    }

    // 2. Calculate Current Total from VISIBLE CHECKPOINTS
    // This ensures that "All" means "All displayed checkpoints"
    let currentTotalScore = 0;
    let allAssigned = true;

    if (checkpoints.length > 0) {
        checkpoints.forEach(cpObj => {
            const qId = cpObj.data.questionId;
            const grade = currentStudent.grades?.find(g => g.questionId === qId);

            if (grade && grade.score !== null && grade.score !== undefined && grade.score !== '') {
                currentTotalScore += parseInt(grade.score);
            } else {
                allAssigned = false;
            }
        });
    } else {
        allAssigned = false; // No checkpoints rendered? Can't finalize.
    }

    // 3. Update DOM
    const currentTotalSpan = document.getElementById('current-total-grade');
    const maxTotalSpan = document.getElementById('max-total-grade');
    const finalizeBtn = document.getElementById('finalize-grade-button');

    if (currentTotalSpan) currentTotalSpan.textContent = currentTotalScore;
    if (maxTotalSpan) maxTotalSpan.textContent = maxTotal;

    // 4. Handle Button State
    if (finalizeBtn) {
        if (allAssigned && checkpoints.length > 0) {
            finalizeBtn.removeAttribute('disabled');
            finalizeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            finalizeBtn.setAttribute('disabled', 'true');
            finalizeBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

function setupFinalizeButtonListener() {
    const finalizeBtn = document.getElementById('finalize-grade-button');
    if (finalizeBtn) {
        // Clean existing listener if any (simple way is replacing the node or just setting onclick)
        finalizeBtn.onclick = () => {
            if (finalizeBtn.disabled) return;

            // Mark all visible checkpoints as graded manually
            if (checkpoints.length > 0) {
                checkpoints.forEach(cp => {
                    updateManualGradingStatus(window.currentRepository, currentStudent.name, cp.data.questionId, 1, () => { });
                });
            } else {
                // Fallback for single question view
                updateManualGradingStatus(window.currentRepository, currentStudent.name, currentQuestionId, 1, () => { });
            }

            finalizeBtn.setAttribute('disabled', 'true');
            finalizeBtn.classList.add('opacity-50', 'cursor-not-allowed');
            finalizeBtn.innerText = "Graded";
        };
    }
}

function renderComments(studentId, questionId) {
    const container = document.getElementById('grading-overlay-container');
    if (!container) return;
    container.querySelectorAll('.comment-bubble').forEach(el => el.remove());
    const repoComments = window.currentRepository.appState.comments || [];
    const relevantComments = repoComments.filter(c => c.studentId === studentId && c.questionId === questionId);
    relevantComments.forEach(comment => createCommentElement(comment));
}

function createCommentElement(commentData) {
    const container = document.getElementById('grading-overlay-container');
    const el = document.createElement('div');
    el.className = 'comment-bubble absolute z-30 bg-[#1e293b] border border-gray-700 shadow-xl rounded-xl w-[260px] transition-transform duration-200 pointer-events-auto';
    el.style.left = commentData.position.x;
    el.style.top = commentData.position.y;

    el.innerHTML = `
        <div class="flex items-center justify-between p-3 border-b border-gray-700 bg-[#0f172a]/50 rounded-t-xl cursor-move handle">
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-blue-400 text-sm">comment</span>
                <span class="font-bold text-xs text-gray-300">Comment</span>
            </div>
            <button class="text-gray-500 hover:text-red-400 delete-btn transition-colors">
                <span class="material-symbols-outlined text-sm">close</span>
            </button>
        </div>
        <div class="p-3">
            <textarea class="w-full text-sm bg-transparent border-none focus:ring-0 resize-y text-gray-200 placeholder-gray-500 min-h-[60px]" placeholder="Type your comment...">${commentData.text}</textarea>
        </div>
    `;

    const textarea = el.querySelector('textarea');
    textarea.addEventListener('input', (e) => {
        commentData.text = e.target.value;
        saveRepositoryState();
    });

    el.querySelector('.delete-btn').addEventListener('click', () => {
        el.remove();
        const idx = window.currentRepository.appState.comments.indexOf(commentData);
        if (idx > -1) {
            window.currentRepository.appState.comments.splice(idx, 1);
            saveRepositoryState();
        }
    });

    const handle = el.querySelector('.handle');
    handle.addEventListener('mousedown', (e) => startDragComment(e, el, commentData));
    container.appendChild(el);
    return el;
}

function startDragComment(e, el, data) {
    e.preventDefault();
    isDragging = true;
    draggedElement = el;
    const rect = el.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

    const onDragComment = (e) => {
        if (!isDragging || !draggedElement) return;
        e.preventDefault();
        const overlayContainer = document.getElementById('grading-overlay-container');
        const containerRect = overlayContainer.getBoundingClientRect();
        let newLeft = e.clientX - dragOffsetX - containerRect.left;
        let newTop = e.clientY - dragOffsetY - containerRect.top;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;

        draggedElement.style.left = `${newLeft}px`;
        draggedElement.style.top = `${newTop}px`;
        data.position.x = `${(newLeft / containerRect.width) * 100}%`;
        data.position.y = `${(newTop / containerRect.height) * 100}%`;
    };

    const stopDragComment = () => {
        isDragging = false;
        draggedElement = null;
        document.removeEventListener('mousemove', onDragComment);
        document.removeEventListener('mouseup', stopDragComment);
        saveRepositoryState();
    };
    document.addEventListener('mousemove', onDragComment);
    document.addEventListener('mouseup', stopDragComment);
}

function setupComments() {
    const addBtn = document.getElementById('add-comment-btn');
    if (addBtn) {
        const newBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newBtn, addBtn);
        newBtn.addEventListener('click', () => {
            if (!currentStudent || !currentQuestionId) return;
            const newComment = {
                studentId: currentStudent.id,
                questionId: currentQuestionId,
                text: '',
                position: { x: '50%', y: '20%' }
            };
            if (!window.currentRepository.appState.comments) {
                window.currentRepository.appState.comments = [];
            }
            window.currentRepository.appState.comments.push(newComment);
            createCommentElement(newComment);
            saveRepositoryState();
        });
    }
}

export function initializeScrollToRubricButtons() {
    // Use Event Delegation for dynamically created buttons
    document.addEventListener('click', async (e) => {
        const button = e.target.closest('.rubric-scroll-btn');
        if (!button) return;

        console.log("[RubricScroll] Button clicked");
        e.stopPropagation(); // Prevent any parent click handlers

        // Find the checkpoint index associated with this button
        // The button is inside a checkpoint element with ID "source{index}"
        const checkpointEl = button.closest('[id^="source"]');
        if (!checkpointEl) {
            console.warn("[RubricScroll] Could not find parent checkpoint element.");
            return;
        }

        // Extract index from ID "source1", "source2", etc.
        const indexStr = checkpointEl.id.replace('source', '');
        const index = parseInt(indexStr) - 1; // 0-based index

        if (isNaN(index) || index < 0 || index >= checkpoints.length) {
            console.warn(`[RubricScroll] Invalid checkpoint index: ${index}`);
            return;
        }

        const checkpoint = checkpoints[index];
        const qId = checkpoint.data.questionId;

        // Get rubric data from the checkpoint
        // We need to find the matching gradingCheckpoint in the repo to get rubricPage and position
        // The checkpoint.data might already have it if it came from repo.gradingCheckpoints
        const rubricPage = checkpoint.data.rubricPage;
        const rubricPosition = checkpoint.data.position;

        console.log(`[RubricScroll] Question: ${qId}, Page: ${rubricPage}, Pos:`, rubricPosition);

        if (!rubricPage) {
            console.warn(`[RubricScroll] No rubric page defined for ${qId}`);
            alert("No rubric page defined for this checkpoint.");
            return;
        }

        const rubricTabBtn = document.getElementById('rubric-tab-btn');
        const referenceTabBtn = document.getElementById('reference-tab-btn');
        const broadcastsTabBtn = document.getElementById('broadcasts-tab-btn');
        const rubricContent = document.getElementById('rubric-content');
        const referenceContent = document.getElementById('reference-content');
        const broadcastsContent = document.getElementById('broadcasts-content');
        const pdfZoomControls = document.getElementById('pdf-zoom-controls');
        const rightPanelFooter = document.getElementById('right-panel-footer');

        // Ensure Rubric tab is active
        if (!rubricTabBtn.classList.contains('text-primary')) {
            console.log("[RubricScroll] Switching to Rubric tab manually");

            // Deactivate others
            [rubricTabBtn, referenceTabBtn, broadcastsTabBtn].forEach(btn => {
                if (btn) {
                    btn.classList.remove('text-primary', 'border-primary', 'bg-primary/10');
                    btn.classList.add('text-gray-500', 'dark:text-gray-400', 'hover:bg-gray-100', 'dark:hover:bg-gray-700/50', 'hover:text-primary', 'border-transparent');
                }
            });
            [rubricContent, referenceContent, broadcastsContent].forEach(content => {
                if (content) content.classList.add('hidden');
            });

            // Activate Rubric
            rubricTabBtn.classList.add('text-primary', 'border-primary', 'bg-primary/10');
            rubricTabBtn.classList.remove('text-gray-500', 'dark:text-gray-400', 'hover:bg-gray-100', 'dark:hover:bg-gray-700/50', 'hover:text-primary', 'border-transparent');
            rubricContent.classList.remove('hidden');

            // Show controls
            if (pdfZoomControls) pdfZoomControls.classList.remove('hidden');
            if (rightPanelFooter) rightPanelFooter.classList.remove('hidden');

            // Update selectors visibility
            const rubricSelector = document.getElementById('rubric-selector-container');
            const referenceSelector = document.getElementById('reference-selector-container');
            if (rubricSelector) rubricSelector.classList.remove('hidden');
            if (referenceSelector) referenceSelector.classList.add('hidden');

            // Trigger render if needed
            if (window.initializeRubricViewer) {
                await window.initializeRubricViewer();
            }
        }

        // Allow UI to update (tab switch) before rendering/scrolling
        setTimeout(async () => {
            // Ensure Rubric is rendered
            const rubricContainer = document.getElementById('rubric-viewer-container');
            let pages = rubricContainer.querySelectorAll('canvas');

            // Robust check: If no pages found, render regardless of cache
            if (pages.length === 0) {
                console.log("[RubricScroll] No pages found. Rendering...");
                if (window.initializeRubricViewer) {
                    const success = await window.initializeRubricViewer();
                    if (!success) return;
                    pages = rubricContainer.querySelectorAll('canvas');
                }
            }

            console.log(`[RubricScroll] Found ${pages.length} pages in rubric container.`);
            const targetPageCanvas = pages[rubricPage - 1]; // 0-based index

            if (targetPageCanvas) {
                console.log("[RubricScroll] Target canvas found. Scrolling and highlighting.");

                // Calculate position
                // position.y is a percentage string like "95%"
                const yPercent = parseFloat(rubricPosition.y);
                const xPercent = parseFloat(rubricPosition.x);

                const topPx = (yPercent / 100) * targetPageCanvas.height;
                const leftPx = (xPercent / 100) * targetPageCanvas.width;

                // Scroll to the specific position
                // We need to account for the canvas's offset within the container
                // The container is #rubric-content (overflow-y-auto)
                // The canvas is inside #rubric-viewer-container

                const scrollContainer = document.getElementById('rubric-content');

                // Calculate absolute top of the target point relative to the scroll container
                const canvasRect = targetPageCanvas.getBoundingClientRect();
                const containerRect = scrollContainer.getBoundingClientRect();

                // Current scroll position
                const currentScroll = scrollContainer.scrollTop;

                // Distance from top of container to top of canvas
                // We can use offsetTop if they are in the same offset context, 
                // but rubric-viewer-container might complicate things.
                // Safest is:
                const relativeTop = targetPageCanvas.offsetTop;

                // Scroll to the top of the page to ensure full context is visible
                // Add a small margin (20px)
                const targetScrollTop = relativeTop - 20;

                scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });

                // Draw Orange Box
                const existingHighlight = document.getElementById('rubric-highlight-box');
                if (existingHighlight) existingHighlight.remove();

                // We append the highlight to rubric-viewer-container (relative) so it scrolls with content
                // But we need to position it absolutely relative to that container

                const highlightBox = document.createElement('div');
                highlightBox.id = 'rubric-highlight-box';
                highlightBox.style.position = 'absolute';
                highlightBox.style.border = '4px solid #fb923c'; // orange-400
                highlightBox.style.backgroundColor = 'rgba(251, 146, 60, 0.2)';
                highlightBox.style.pointerEvents = 'none';
                highlightBox.style.zIndex = '50';
                highlightBox.style.borderRadius = '8px';
                highlightBox.style.transition = 'opacity 0.5s';

                // Define a fixed size for the highlight box, centered on the target
                const boxWidth = targetPageCanvas.width * 0.95; // 95% of page width
                const boxHeight = targetPageCanvas.height * 0.95; // 95% of page height

                highlightBox.style.width = `${boxWidth}px`;
                highlightBox.style.height = `${boxHeight}px`;

                // Center horizontally
                highlightBox.style.left = `${targetPageCanvas.offsetLeft + (targetPageCanvas.width - boxWidth) / 2}px`;

                // Center vertically on the PAGE, not the specific point
                highlightBox.style.top = `${targetPageCanvas.offsetTop + (targetPageCanvas.height - boxHeight) / 2}px`;

                rubricContainer.appendChild(highlightBox);

                setTimeout(() => {
                    highlightBox.style.opacity = '0';
                    setTimeout(() => highlightBox.remove(), 500);
                }, 3000);
            } else {
                console.warn(`[RubricScroll] Target canvas for page ${rubricPage} not found.`);
            }
        }, 50);
    });
}