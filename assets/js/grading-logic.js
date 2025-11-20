/**
 * Determines the category for a grade based on thresholds and status.
 * 
 * @param {number} confidence - AI confidence (0-100).
 * @param {number} score - AI suggested score.
 * @param {number} maxPoints - Maximum points for the question.
 * @param {number} manualStatus - Manual grading status (0=None, 1=Once, 2=Twice).
 * @param {Object} thresholds - { aiConfidenceThreshold, studentScoreThreshold }.
 * @returns {string} - Category key ('aiHigh', 'aiLow', 'lowScore', 'gradedOnce', 'graded2Plus').
 */
export function determineCategory(confidence, score, maxPoints, manualStatus, thresholds) {
    if (manualStatus >= 2) return 'graded2Plus';
    if (manualStatus === 1) return 'gradedOnce';

    const { aiConfidenceThreshold, studentScoreThreshold } = thresholds;
    const scorePercentage = maxPoints > 0 ? (score / maxPoints) * 100 : 0;

    if (confidence < aiConfidenceThreshold) return 'aiLow';
    if (scorePercentage < studentScoreThreshold) return 'lowScore';
    return 'aiHigh';
}

/**
 * Calculates grading statistics for the entire repository based on current parameters.
 * 
 * @param {Object} repository - The full exam repository object.
 * @param {Object} parameters - Grading parameters (thresholds).
 * @returns {Object} - Contains global stats and per-question stats.
 */
export function calculateGradingStats(repository, parameters) {
    if (!repository || !repository.questions || !repository.studentSubmissions) {
        return null;
    }

    // Initialize global counters
    let globalStats = {
        aiHigh: 0,
        aiLow: 0,
        lowScore: 0,
        gradedOnce: 0,
        graded2Plus: 0,
        totalWeight: 0
    };

    const questionStats = {};

    // Helper to find a student's grade for a specific question item
    const findGrade = (studentId, questionId) => {
        const student = repository.studentSubmissions.find(s => s.id === studentId);
        if (!student || !student.grades) return null;
        return student.grades.find(g => g.questionId === questionId);
    };

    // 1. Determine Weights
    // Top-level questions share the total weight equally (e.g., 4 questions -> 25% each)
    const numQuestions = repository.questions.length;
    const weightPerQuestion = 100 / numQuestions;

    repository.questions.forEach(question => {
        const isParent = question.subquestions && question.subquestions.length > 0;
        const subItems = isParent ? question.subquestions : [question];
        const weightPerSubItem = weightPerQuestion / subItems.length;

        // Initialize stats for the top-level question (aggregated)
        questionStats[question.id] = {
            aiHigh: 0,
            aiLow: 0,
            lowScore: 0,
            gradedOnce: 0,
            graded2Plus: 0,
            totalCount: 0
        };

        subItems.forEach(item => {
            const itemId = item.id;
            const maxPoints = item.points || 0;

            // Iterate through all students to calculate stats for this item
            repository.studentSubmissions.forEach(student => {
                const grade = findGrade(student.id, itemId);

                let category = 'aiLow'; // Default fallback

                if (grade) {
                    const manualStatus = grade.manualStatus || 0;
                    const confidence = grade.confidence || 0;
                    const score = grade.aiSuggestedScore || 0;

                    category = determineCategory(confidence, score, maxPoints, manualStatus, parameters);
                }

                // Update Local Stats (Aggregated for the Question)
                questionStats[question.id][category]++;
                questionStats[question.id].totalCount++;

                // Update Global Stats (Weighted)
                const contribution = (1 / repository.studentSubmissions.length) * weightPerSubItem;
                globalStats[category] += contribution;
                globalStats.totalWeight += contribution;
            });
        });

        // Convert Aggregated Stats to Percentages
        const total = questionStats[question.id].totalCount;
        if (total > 0) {
            for (const key in questionStats[question.id]) {
                if (key !== 'totalCount') {
                    questionStats[question.id][key] = (questionStats[question.id][key] / total) * 100;
                }
            }
        }
    });

    return { globalStats, questionStats };
}

