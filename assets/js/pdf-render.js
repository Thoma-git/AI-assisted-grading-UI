
// Global counter to track the active render task
let currentRenderId = 0;

/**
 * Initializes the PDF viewer and renders the document.
 * Wraps each page in a relative container for precise overlay positioning.
 * 
 * @param {string} pdfUrl - URL of the PDF to render.
 * @param {number|string} pageToShow - Page number to scroll to after rendering.
 */
export async function initializePdfViewer(pdfUrl, pageToShow) {
    const pdfPageContainer = document.getElementById('pdf-page-container');
    const gradingPanel = document.getElementById('grading-panel');
    if (!pdfPageContainer) return;

    // 1. Update Globals so ResizeObserver knows what to re-render
    if (pdfUrl) window.currentPdfUrl = pdfUrl;
    if (pageToShow) window.currentPageNumber = pageToShow;

    // 2. Concurrency Control: Create a unique ID for THIS render attempt
    const myRenderId = ++currentRenderId;

    if (!pdfUrl) pdfUrl = 'assets/exams/dummy-exam.pdf';

    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) {
        console.error("PDF.js library not loaded.");
        return;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfjsWorker;

    try {
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;

        // STOP if a newer render has started since we began loading
        if (myRenderId !== currentRenderId) return;

        const numPages = pdf.numPages;
        console.log(`[PdfRender] PDF loaded. Pages: ${numPages}`);
        const pagesToRender = Array.from({ length: numPages }, (_, i) => i + 1);

        // Clear OLD content
        pdfPageContainer.innerHTML = '';
        // Re-add the global overlay container
        const globalOverlay = document.createElement('div');
        globalOverlay.id = 'grading-overlay-container';
        globalOverlay.className = 'absolute inset-0 pointer-events-none z-10';
        pdfPageContainer.appendChild(globalOverlay);


        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            // STOP immediately if a newer render has started
            if (myRenderId !== currentRenderId) return;

            const page = await pdf.getPage(pageNum);

            // Viewport math
            // We need to calculate scale based on the container width
            const containerStyle = window.getComputedStyle(pdfPageContainer);
            const desiredWidth = pdfPageContainer.clientWidth - parseFloat(containerStyle.paddingLeft) - parseFloat(containerStyle.paddingRight) - 10;
            const viewport = page.getViewport({ scale: 1 });
            const scale = desiredWidth / viewport.width;
            console.log(`[PdfRender] Page ${pageNum}: Container Width: ${pdfPageContainer.clientWidth}, Desired: ${desiredWidth}, Viewport: ${viewport.width}, Scale: ${scale}`);
            const scaledViewport = page.getViewport({ scale });

            // Create Page Wrapper
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-wrapper relative mb-4 shadow-md';
            pageWrapper.setAttribute('data-page-number', pageNum);
            pageWrapper.style.width = `${scaledViewport.width}px`;
            pageWrapper.style.height = `${scaledViewport.height}px`;

            // Create Canvas
            const canvas = document.createElement('canvas');
            canvas.className = 'block';
            const context = canvas.getContext('2d');
            canvas.height = scaledViewport.height;
            canvas.width = scaledViewport.width;

            // Create Page Overlay
            const pageOverlay = document.createElement('div');
            pageOverlay.className = 'page-overlay absolute inset-0 pointer-events-none z-20';
            pageOverlay.setAttribute('data-page-number', pageNum);

            // Assemble
            pageWrapper.appendChild(canvas);
            pageWrapper.appendChild(pageOverlay);

            // Insert before global overlay to keep DOM clean, though z-index handles stacking
            pdfPageContainer.insertBefore(pageWrapper, globalOverlay);

            const renderContext = {
                canvasContext: context,
                viewport: scaledViewport
            };

            await page.render(renderContext).promise;
        }

        // Final check before UI updates
        if (myRenderId !== currentRenderId) return false;

        // Trigger arrow setup if it exists globally
        if (typeof window.setupArrows === 'function') {
            window.setupArrows();
        }

        // Scroll Logic
        if (pageToShow && gradingPanel) {
            const targetPageNum = parseInt(pageToShow);
            const targetWrapper = pdfPageContainer.querySelector(`.page-wrapper[data-page-number="${targetPageNum}"]`);

            if (targetWrapper) {
                setTimeout(() => {
                    gradingPanel.scrollTo({
                        top: targetWrapper.offsetTop - 20,
                        behavior: 'smooth'
                    });
                }, 100);
            }
        }
        return true;

    } catch (error) {
        console.error('Error rendering PDF:', error);
        return false;
    }
}
