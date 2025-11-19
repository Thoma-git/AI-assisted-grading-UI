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
    document.getElementById('grading-panel').innerHTML = '<div id="pdf-page-container" class="relative min-h-full flex flex-col items-center pb-32"><div id="grading-overlay-container" class="absolute inset-0 pointer-events-none z-10"></div></div>';

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

    // Initialize viewer
    await window.initializePdfViewer(pdfUrl, pageNumber);

    // Render UI elements
    renderGradingCheckpoints(questionId);
    renderComments(student.id, questionId);
    setupNavigationCircles(questionId);

    // Update totals immediately after render
    updateTotalScoreDisplay();

    // Trigger calculation loop for positioning
    calculateCheckpointBasePositions(0);
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
    let relevantCheckpoints = repo.gradingCheckpoints.filter(cp => cp.questionId === questionId);

    // Fallback search logic for related checkpoints
    if (relevantCheckpoints.length === 0) {
        const currentQuestion = repo.questions.find(q => q.id === questionId);
        if (currentQuestion?.subquestions) {
            const sub = currentQuestion.subquestions.find(s => repo.gradingCheckpoints.some(cp => cp.questionId === s.id));
            if (sub) relevantCheckpoints = repo.gradingCheckpoints.filter(cp => cp.questionId === sub.id);
        } else {
            const parent = repo.questions.find(q => q.subquestions?.some(sub => sub.id === questionId));
            if (parent) {
                const sibling = parent.subquestions.find(sub => repo.gradingCheckpoints.some(cp => cp.questionId === sub.id));
                if (sibling) relevantCheckpoints = repo.gradingCheckpoints.filter(cp => cp.questionId === sibling.id);
            }
        }
    }

    // Calculate Max Points for Input Validation (Per Checkpoint/Question)
    let maxPoints = 0;
    const qData = repo.questions.find(q => q.id === questionId) || repo.questions.find(q => q.subquestions?.some(sq => sq.id === questionId));
    if (qData) {
        if (qData.id === questionId && qData.points) maxPoints = qData.points;
        else if (qData.subquestions) {
            const sub = qData.subquestions.find(sq => sq.id === questionId);
            maxPoints = sub ? sub.points : qData.subquestions.reduce((acc, curr) => acc + (curr.points || 0), 0);
        }
    }
    if (!maxPoints) maxPoints = 5;

    relevantCheckpoints.forEach((cp, index) => {
        const gradeEntry = currentStudent.grades?.find(g => g.questionId === cp.questionId) || {}; // Use cp.questionId specifically
        const aiConfidence = gradeEntry.confidence || 0;
        const aiSuggestedPoints = gradeEntry.aiSuggestedScore || 0;
        const currentScore = gradeEntry.score;
        const aiComment = gradeEntry.comment || '';

        let pillBg = 'rgba(239, 68, 68, 0.2)'; let pillText = '#f87171';
        if (aiConfidence > 80) { pillBg = 'rgba(16, 185, 129, 0.2)'; pillText = '#34d399'; }
        else if (aiConfidence > 50) { pillBg = 'rgba(251, 191, 36, 0.2)'; pillText = '#fbbf24'; }

        const el = document.createElement('div');
        el.id = `source${index + 1}`;
        el.className = 'absolute group bg-[#1e293b] rounded-lg shadow-lg pointer-events-auto select-none flex flex-col transition-transform transform-gpu';

        el.style.cssText = `
            width: 620px; 
            max-width: 95%; 
            left: ${cp.position.x}; 
            transform: translateX(-50%); 
            border: 1px solid #374151;
            z-index: 20;
            opacity: 0; 
            transition: opacity 0.2s ease-in;
        `;

        // IMPORTANT: The input calls window.handleScoreChange with this checkpoint's specific ID
        el.innerHTML = `
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

        container.appendChild(el);
        checkpoints.push({ data: cp, element: el, baseTop: 0 });

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

        // ... Rubric Scroll Logic (unchanged) ...
        const rubricBtn = el.querySelector('.rubric-scroll-btn');
        rubricBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rubricContainer = document.getElementById('rubric-content');
            const targetHighlight = document.getElementById(`target${index + 1}`);
            const rubricTabBtn = document.getElementById('rubric-tab-btn');

            if (rubricTabBtn) rubricTabBtn.click();
            if (rubricContainer && targetHighlight) {
                rubricContainer.scrollTo({ top: targetHighlight.offsetTop - 150, behavior: 'smooth' });
                targetHighlight.classList.add('bg-orange-500/30');
                setTimeout(() => targetHighlight.classList.remove('bg-orange-500/30'), 1500);
            }
        });
    });
}

function calculateCheckpointBasePositions(retryCount = 0) {
    const pdfContainer = document.getElementById('pdf-page-container');
    const canvases = pdfContainer ? Array.from(pdfContainer.querySelectorAll('canvas')) : [];

    if (canvases.length === 0 && retryCount < 20) {
        setTimeout(() => calculateCheckpointBasePositions(retryCount + 1), 50);
        return;
    }

    let avgHeight = 0;
    let validHeightCount = 0;
    const pagePositions = [];
    let currentTop = 0;

    canvases.forEach(canvas => {
        const h = canvas.clientHeight;
        if (h > 0) {
            avgHeight += h;
            validHeightCount++;
        }
        pagePositions.push({ top: currentTop, height: h });
        currentTop += (h || 1100) + PAGE_MARGIN;
    });

    if (validHeightCount > 0) avgHeight = avgHeight / validHeightCount;
    else avgHeight = 1100;

    let allReady = true;

    checkpoints.forEach(cp => {
        let pageIdx = (cp.data.page || 1) - 1;
        if (pageIdx >= pagePositions.length) {
            // Allow theoretical positions if pages not rendered
        }
        if (pageIdx < 0) pageIdx = 0;

        let pageTop = 0;
        let pageHeight = avgHeight;

        if (pageIdx < pagePositions.length) {
            pageTop = pagePositions[pageIdx].top;
            const h = pagePositions[pageIdx].height;
            if (h > 0) pageHeight = h;
        } else {
            // Theoretical Calculation
            if (pagePositions.length > 0) {
                const lastPage = pagePositions[pagePositions.length - 1];
                const lastPageH = lastPage.height > 0 ? lastPage.height : avgHeight;
                const lastPageBottom = lastPage.top + lastPageH + PAGE_MARGIN;
                const missingPages = pageIdx - pagePositions.length;
                pageTop = lastPageBottom + (missingPages * (avgHeight + PAGE_MARGIN));
            } else {
                pageTop = pageIdx * (avgHeight + PAGE_MARGIN);
            }
        }

        let relativeY = 0;
        if (typeof cp.data.position.y === 'string' && cp.data.position.y.includes('%')) {
            const pct = parseFloat(cp.data.position.y);
            relativeY = (pct / 100) * pageHeight;
        } else {
            relativeY = parseFloat(cp.data.position.y) || (pageHeight - 50);
        }

        cp.baseTop = pageTop + relativeY;
        cp.element.style.opacity = '1';

        if (pageIdx < pagePositions.length && pagePositions[pageIdx].height === 0) allReady = false;
    });

    updateCheckpointPositions();

    if (!allReady && retryCount < 20) {
        setTimeout(() => calculateCheckpointBasePositions(retryCount + 1), 50);
    }
}

function startDrag(e, el, checkpointData) {
    e.preventDefault();
    isDragging = true;
    draggedElement = el;

    const rect = el.getBoundingClientRect();
    const overlayContainer = document.getElementById('grading-overlay-container');
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

        const cpState = checkpoints.find(c => c.element === el);
        if (cpState) {
            cpState.baseTop = newTop;
            checkpointData.position.x = `${(newLeft / containerRect.width) * 100}%`;
        }
    };

    const stopDrag = () => {
        isDragging = false;
        draggedElement = null;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        updateCheckpointPositions();
    };

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
}

function setupSmartRendering() {
    const panel = document.getElementById('grading-panel');
    if (!panel) return;
    panel.addEventListener('scroll', () => {
        requestAnimationFrame(updateCheckpointPositions);
    });
}

function updateCheckpointPositions() {
    checkpoints.forEach((cp) => {
        if (cp.element.style.opacity === '0') return;
        cp.element.style.top = `${cp.baseTop}px`;
    });
}

function setupGlobalEventListeners() {
    const panel = document.getElementById('grading-panel');
    if (panel) {
        new ResizeObserver(() => {
            calculateCheckpointBasePositions(0);
        }).observe(panel);
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

    let targetTop = cp.baseTop;
    if (targetTop === 0 && cp.data.page > 1) {
        calculateCheckpointBasePositions(20);
        targetTop = cp.baseTop;
    }

    panel.scrollTo({ top: targetTop - 150, behavior: 'smooth' });
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
    const repo = window.currentRepository;
    let maxTotal = 0;

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

    const qData = findQuestion(repo.questions, currentQuestionId);
    if (qData) {
        if (qData.points) {
            maxTotal = qData.points;
        } else if (qData.subquestions) {
            maxTotal = qData.subquestions.reduce((acc, curr) => acc + (curr.points || 0), 0);
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