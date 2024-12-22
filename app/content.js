// Initialize the content script
console.log('Content script loaded in frame:', window.location.href);

function getAssociatedText(element) {
    const texts = [];
    
    // Get label text
    if (element.id) {
        const labels = document.querySelectorAll(`label[for="${element.id}"]`);
        labels.forEach(label => texts.push(label.textContent.trim()));
    }

    // Get parent label text
    const parentLabel = element.closest('label');
    if (parentLabel) {
        texts.push(parentLabel.textContent.trim());
    }

    // Get sub-label text
    const subLabel = element.parentElement?.querySelector('.form-sub-label');
    if (subLabel) {
        texts.push(subLabel.textContent.trim());
    }

    // Get text from parent's direct text nodes
    if (element.parentElement) {
        Array.from(element.parentElement.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .forEach(node => {
                const text = node.textContent.trim();
                if (text) texts.push(text);
            });
    }

    return [...new Set(texts)].filter(text => text.length > 0);
}

function findFormFields() {
    const fields = [];
    
    // Find all form-line elements
    const formLines = document.querySelectorAll('.form-line');
    console.log(`Found ${formLines.length} form lines in frame:`, window.location.href);
    
    formLines.forEach(line => {
        // Get main label text
        const mainLabel = line.querySelector('.form-label');
        const mainText = mainLabel ? mainLabel.textContent.trim() : '';

        // Find all inputs and textareas in this line
        const inputs = line.querySelectorAll('input:not([type="hidden"]), textarea');
        inputs.forEach(input => {
            const associatedText = getAssociatedText(input);
            
            fields.push({
                text: mainText,
                input: {
                    id: input.id || '',
                    name: input.name || '',
                    type: input.type || 'text',
                    placeholder: input.placeholder || '',
                    associatedText: associatedText
                }
            });
        });
    });

    return {
        frameUrl: window.location.href,
        fields: fields
    };
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Message received in frame:', window.location.href);
    
    if (request.action === 'analyzeInputs') {
        try {
            const results = findFormFields();
            console.log('Found form fields in frame:', results);
            sendResponse({ success: true, data: results });
        } catch (e) {
            console.error('Error in analyzeInputs:', e);
            sendResponse({ success: false, error: e.message });
        }
    }
    return true;
});

// Notify that the content script is ready
console.log('Content script initialized'); 