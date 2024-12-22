document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const saveKeyButton = document.getElementById('saveKey');
    const fileSelect = document.getElementById('fileSelect');
    const fileInput = document.getElementById('fileInput');
    const addFileButton = document.getElementById('addFile');
    const deleteFileButton = document.getElementById('deleteFile');
    const testFillButton = document.getElementById('testFill');
    const serverUrlInput = document.getElementById('serverUrl');
    const apiTypeRadios = document.getElementsByName('apiType');
    const modelSelect = document.getElementById('modelSelect');

    let currentFormFields = null;

    // Load saved API key if it exists
    chrome.storage.local.get(['openai_api_key'], (result) => {
        if (result.openai_api_key) {
            apiKeyInput.value = result.openai_api_key;
        }
    });

    // Save API key
    saveKeyButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            chrome.storage.local.set({ openai_api_key: apiKey }, () => {
                alert('API key saved successfully!');
            });
        }
    });

    // Load saved files list
    async function loadFilesList() {
        try {
            const result = await chrome.storage.local.get(['formDataFiles']);
            const files = result.formDataFiles || [];
            
            fileSelect.innerHTML = '<option value="">Select a file with form data...</option>';
            files.forEach(file => {
                const option = document.createElement('option');
                option.value = file.name;
                option.textContent = file.name;
                fileSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading files list:', error);
        }
    }

    // Handle file upload
    addFileButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
            // Read file as plain text
            const text = await file.text();
            console.log('Loaded file content:', text);

            // Save to storage as is
            const result = await chrome.storage.local.get(['formDataFiles']);
            const files = result.formDataFiles || [];
            
            // Check if file with same name exists
            const existingIndex = files.findIndex(f => f.name === file.name);
            if (existingIndex >= 0) {
                if (!confirm('File with same name exists. Replace it?')) {
                    return;
                }
                files[existingIndex] = { 
                    name: file.name, 
                    content: text,
                    timestamp: new Date().toISOString()
                };
            } else {
                files.push({ 
                    name: file.name, 
                    content: text,
                    timestamp: new Date().toISOString()
                });
            }

            await chrome.storage.local.set({ formDataFiles: files });
            await loadFilesList();
            fileSelect.value = file.name;
            
            // Clear the input
            fileInput.value = '';

            // Show success message
            alert('File uploaded successfully!');

        } catch (error) {
            console.error('Error reading file:', error);
            alert('Error reading file.');
        }
    });

    // Delete selected file
    deleteFileButton.addEventListener('click', async () => {
        const selectedFile = fileSelect.value;
        if (!selectedFile) {
            alert('Please select a file to delete');
            return;
        }

        if (confirm('Are you sure you want to delete this file?')) {
            try {
                const result = await chrome.storage.local.get(['formDataFiles']);
                const files = result.formDataFiles || [];
                const updatedFiles = files.filter(f => f.name !== selectedFile);
                await chrome.storage.local.set({ formDataFiles: updatedFiles });
                await loadFilesList();
            } catch (error) {
                console.error('Error deleting file:', error);
                alert('Error deleting file');
            }
        }
    });

    // Scan page for input fields
    

    // Move handleFieldMatching function from background.js
    async function handleFieldMatching(request) {
        try {
            console.log('Starting field matching process');
            
            // Get selected API type and server URL
            const apiType = Array.from(apiTypeRadios).find(r => r.checked)?.value || 'openai';
            const serverUrl = apiType === 'local' ? serverUrlInput.value : 'https://api.openai.com';
            const model = apiType === 'local' ? 'gpt-4o-mini' : modelSelect.value;
            
            console.log('Using API:', apiType, 'Server:', serverUrl, 'Model:', model);

            console.log('Form Fields to match:', request.formFields);
            console.log('Raw form data:', request.formData);

            const prompt = `Please analyze these form fields and match them with the provided form data:



Step by step how to proceed:
1. Search the JSON structure for all  "input" objects/key that have a "name" or "id" Field
2. For each of these input objects do the following:
2.1. Look for matching information in the repective objectin each field of the object
2.2. Get more context about the input from it's parent object/key name
2.3. Return a structure with identificable input name or id, and a value field. (see <return example>)
2.4. Only add values where you're confident about the match
2.5. Look for semantic matches, not just exact text matches
7. If an input has ID and Name put them both in the return
8. If a field has multiple potential matches, choose the most likely one
9. Convert dates to the format in the placeholder 
10. Convert phone numbers to the format in the placeholder 
11. If you can figre out some values from the context like gender from the name or age from the birthdate, add them as well
12. If there are multiple fields with the same porpose (e.g. multiple names) add them all



REPLY JUST WITH THE JSON, NO OTHER TEXT

<return example>
{fields: [
{
    "id": "firstName1",
    "value": "John"
},
{
    "name": "lastName1",
    "value": "Doe"
},
{
    "id": "city1",
    "name": "city1",
    "value": "Paris"
}
]}
</return example>




Form Fields:
<form fields>
${JSON.stringify(request.formFields, null, 2)}
</form fields>

Form Fill-in Data:
<fill in data>
${request.formData.content}
</fill in data>


`;

            console.log('Sending prompt to OpenAI:', prompt);
            
            const response = await fetch(`${serverUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${request.apiKey}`
                },
                body: JSON.stringify({
                    model: modelSelect.value,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a form field matching assistant. Match form fields with provided data and return JSON.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 2000,
                    presence_penalty: 0,
                    frequency_penalty: 0
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('OpenAI API error:', error);
                return { error: error.error?.message || 'API request failed' };
            }

            const data = await response.json();
            
            try {
                // Extract only the JSON part from the response and clean it
                let jsonContent = data.choices[0].message.content;
                
                // Remove markdown code block markers
                jsonContent = jsonContent.replace(/```json\n/g, '').replace(/```/g, '');
                
                // Remove comments (// ...)
                jsonContent = jsonContent.replace(/\/\/[^\n]*\n/g, '\n');
                
                // Find the actual JSON content
                const startIndex = jsonContent.indexOf('{');
                const endIndex = jsonContent.lastIndexOf('}') + 1;
                
                if (startIndex === -1 || endIndex === 0) {
                    throw new Error('No valid JSON found in response');
                }
                
                jsonContent = jsonContent.substring(startIndex, endIndex);
                console.log('Cleaned JSON content:', jsonContent);

                const matchedFields = JSON.parse(jsonContent);
                return { success: true, data: matchedFields };
            } catch (e) {
                console.error('Failed to parse AI response:', e);
                console.log('Raw AI response:', data.choices[0].message.content);
                return { error: 'Failed to parse AI response. Please try again.' };
            }
        } catch (error) {
            console.error('Error in handleFieldMatching:', error);
            return { error: error.message };
        }
    }

    // Update fill button to use handleFieldMatching directly
    

    function optimizeStructure(fieldsArray) {
        // Helper function to clean text labels
        function cleanText(text) {
            if (!text) return '';
            return text.replace(/\b(field|fields|input|inputs|form|forms)\b/gi, ' ')  // Remove form-related words
                      .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
                      .trim();  // Remove leading/trailing spaces
        }

        // ---------------------------------------
        // 1) Helper: Recursively process each node
        // ---------------------------------------
        function processNode(node) {
            // A) If node is a leaf input (it has tagName and type, and no .children):
            if (node.tagName && node.type) {
                const inputObj = {};
                if (node.name) inputObj.name = node.name;
                if (node.placeholder) inputObj.placeholder = node.placeholder;
                if (node.id) inputObj.id = node.id;
                inputObj.tagName = node.tagName;
                inputObj.type = node.type;
                return { input: inputObj };
            }
    
            // B) If node has "text" and possibly "children", process the children
            const text = node.text ? cleanText(node.text) : '';  // Clean the text
            const childrenArray = node.children || [];
            // Process each child recursively
            const processedChildren = childrenArray
                .map(child => processNode(child))
                .filter(Boolean);
    
            // If no text after cleaning, return children directly, or null if no children
            if (!text) {
                if (processedChildren.length === 1) {
                    return processedChildren[0];
                }
                return processedChildren.length > 0 ? processedChildren : null;
            }
    
            // If text exists but no children remain, skip this node
            if (processedChildren.length === 0) {
                return null;
            }
    
            // C) We have text and some child objects. We need to merge children into a single object
            const merged = {};
    
            // Loop over processedChildren; each can be:
            // { input: {...}}, an object keyed by text (e.g. { "First Name": {...} }), or an array
            for (const ch of processedChildren) {
                if (!ch) continue;
    
                if (ch.input) {
                    // This is a single input child
                    if (!merged.input) {
                        merged.input = ch.input;
                    } else if (Array.isArray(merged.input)) {
                        merged.input.push(ch.input);
                    } else {
                        merged.input = [merged.input, ch.input];
                    }
                } else if (typeof ch === 'object' && !Array.isArray(ch)) {
                    // This is an object with text keys
                    for (const key in ch) {
                        const cleanKey = cleanText(key);  // Clean the key
                        if (!cleanKey) continue;  // Skip if key becomes empty after cleaning
                        
                        if (!merged[cleanKey]) {
                            merged[cleanKey] = ch[key];
                        } else {
                            // key already exists, convert to array
                            if (!Array.isArray(merged[cleanKey])) {
                                merged[cleanKey] = [merged[cleanKey]];
                            }
                            merged[cleanKey].push(ch[key]);
                        }
                    }
                } else if (Array.isArray(ch)) {
                    // This child is an array of items
                    // Merge each array element individually
                    for (const elem of ch) {
                        if (!elem) continue;
    
                        if (elem.input) {
                            if (!merged.input) {
                                merged.input = elem.input;
                            } else if (Array.isArray(merged.input)) {
                                merged.input.push(elem.input);
                            } else {
                                merged.input = [merged.input, elem.input];
                            }
                        } else if (typeof elem === 'object' && !Array.isArray(elem)) {
                            for (const key in elem) {
                                const cleanKey = cleanText(key);  // Clean the key
                                if (!cleanKey) continue;  // Skip if key becomes empty after cleaning
                                
                                if (!merged[cleanKey]) {
                                    merged[cleanKey] = elem[key];
                                } else {
                                    if (!Array.isArray(merged[cleanKey])) {
                                        merged[cleanKey] = [merged[cleanKey]];
                                    }
                                    merged[cleanKey].push(elem[key]);
                                }
                            }
                        }
                    }
                }
            }
    
            if (Object.keys(merged).length === 0) {
                // Nothing to keep after merging
                return null;
            }
    
            // Return an object keyed by the cleaned text
            return { [text]: merged };
        }
    
        // ---------------------------------------
        // 2) Process every item in the array
        // ---------------------------------------
        const processed = fieldsArray
            .map(node => processNode(node))
            .filter(Boolean);
    
        // ---------------------------------------
        // 3) Merge them at the top level by text key
        // ---------------------------------------
        const finalMerged = {};
        for (const obj of processed) {
            // Each obj is something like: { "Passenger Details": {...} }
            for (const key in obj) {
                const cleanKey = cleanText(key);  // Clean the key
                if (!cleanKey) continue;  // Skip if key becomes empty after cleaning
                
                if (!finalMerged[cleanKey]) {
                    finalMerged[cleanKey] = obj[key];
                } else {
                    // We already have this key, so we turn it into an array or push
                    if (!Array.isArray(finalMerged[cleanKey])) {
                        finalMerged[cleanKey] = [finalMerged[cleanKey]];
                    }
                    finalMerged[cleanKey].push(obj[key]);
                }
            }
        }
    
        // Return the merged hierarchical object
        return finalMerged;
    }
    
    

    // Update the test button handler to use the optimized structure
    testFillButton.addEventListener('click', async () => {
        const loader = document.getElementById('loader');
        try {
            // Show loader
            loader.style.display = 'flex';
            testFillButton.disabled = true;

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) {
                throw new Error('No active tab found');
            }
    
            console.log('Starting refined hierarchical DOM scan...');
    
            // Run the script in all frames
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => {
                    function isVisible(el) {
                        if (!el) return false;
                        if (!el.ownerDocument || !el.ownerDocument.contains(el)) return false;
                        let current = el;
                        while (current && current !== document.body) {
                            const style = window.getComputedStyle(current);
                            if (style.display === 'none' || style.visibility === 'hidden') {
                                return false;
                            }
                            current = current.parentElement;
                        }
                        return true;
                    }
    
                    function isFillableField(field) {
                        let fieldType = field.getAttribute('type') || field.tagName.toLowerCase();
                        if (fieldType === 'hidden' || field.readOnly || field.disabled) return false;
                        return true;
                    }
    
                    function getVisibleText(el) {
                        if (!isVisible(el)) return '';
                        let clone = el.cloneNode(true);
                        Array.from(clone.querySelectorAll('input, textarea, select')).forEach(n => n.remove());
                        let text = clone.innerText.trim();
                        if (text.length > 100) {
                            text = text.slice(0, 100) + '…';
                        }
                        return text;
                    }
    
                    function buildHierarchyForInput(input) {
                        let fieldType = input.getAttribute('type') || input.tagName.toLowerCase();
                        let inputNode = {
                            tagName: input.tagName.toLowerCase(),
                            type: fieldType
                        };
                        let fid = input.id || '';
                        if (fid) inputNode.id = fid;
                        let fname = input.getAttribute('name') || '';
                        if (fname) inputNode.name = fname;
                        let placeholder = input.getAttribute('placeholder');
                        if (placeholder && placeholder.trim()) inputNode.placeholder = placeholder.trim();
    
                        // Try to find a label
                        if (input.id) {
                            let directLabel = document.querySelector(`label[for="${input.id}"]`);
                            if (directLabel && isVisible(directLabel)) {
                                let labelText = directLabel.innerText.trim();
                                if (labelText) inputNode.label = labelText;
                            }
                        }
                        let parentLabel = input.closest('label');
                        if (parentLabel && isVisible(parentLabel)) {
                            let labelText = parentLabel.innerText.trim();
                            if (labelText) inputNode.label = labelText;
                        }
    
                        let currentStructure = inputNode;
                        let currentElement = input.parentElement;
                        let levelsUp = 0;
                        let sectionNode = null;
    
                        while (currentElement && currentElement !== document.body) {
                            if (!isVisible(currentElement)) {
                                currentElement = currentElement.parentElement;
                                continue;
                            }
    
                            if (currentElement.tagName && currentElement.tagName.toLowerCase() === 'fieldset') {
                                let legend = currentElement.querySelector('legend');
                                if (legend && isVisible(legend)) {
                                    let legendText = legend.innerText.trim();
                                    if (legendText) {
                                        sectionNode = {
                                            text: legendText
                                        };
                                    }
                                }
                            }
    
                            if (levelsUp < 2) {
                                let text = getVisibleText(currentElement);
                                if (text) {
                                    currentStructure = {
                                        text: text,
                                        children: [currentStructure]
                                    };
                                }
                            }
    
                            currentElement = currentElement.parentElement;
                            levelsUp++;
                        }
    
                        if (sectionNode) {
                            if (currentStructure !== inputNode) {
                                sectionNode.children = [currentStructure];
                            } else {
                                sectionNode.children = [inputNode];
                            }
                            return sectionNode;
                        } else {
                            return currentStructure;
                        }
                    }
    
                    let fields = Array.from(document.querySelectorAll('input, textarea, select'));
                    let resultFields = [];
                    fields.forEach((field) => {
                        if (!isVisible(field)) return;
                        if (!isFillableField(field)) return;
                        let hierarchy = buildHierarchyForInput(field);
                        if (hierarchy) {
                            resultFields.push(hierarchy);
                        }
                    });
    
                    return {
                        url: window.location.href,
                        timestamp: new Date().toISOString(),
                        fields: resultFields
                    };
                }
            });
    
            // Combine results from all frames
            const allFields = results.flatMap(r => (r?.result?.fields || []));
            const url = results[0]?.result?.url || '';
            const timestamp = results[0]?.result?.timestamp || new Date().toISOString();
    
            // Optimize the final combined structure
            const optimizedFields = optimizeStructure(allFields);
    
            const finalResult = {
                url: url,
                timestamp: timestamp,
                form: optimizedFields
            };
    
            console.log('Original Hierarchical JSON:', JSON.stringify({url, timestamp, fields: allFields}, null, 2));
            console.log('Optimized Structure:', JSON.stringify(finalResult, null, 2));
    
//            alert(`Scan complete! Check the console for the optimized structure.`);

            try {
                const selectedFile = fileSelect.value;
                if (!selectedFile) {
                    throw new Error('Please select a form data file');
                }

                if (!optimizedFields) {
                    throw new Error('Please scan the form first');
                }

                console.log('Starting form fill process');

                // Get API key
                const { openai_api_key } = await chrome.storage.local.get(['openai_api_key']);
                if (!openai_api_key) {
                    throw new Error('Please save your OpenAI API key first');
                }

                // Get form data from selected file
                const { formDataFiles } = await chrome.storage.local.get(['formDataFiles']);
                const fileData = formDataFiles?.find(f => f.name === selectedFile);

                console.log('Retrieved file data:', fileData);

                if (!fileData?.content) {
                    throw new Error('Could not find form data content');
                }

                // Match fields with AI directly
                console.log('%cStep 1: Sending to AI for matching...', 'color: blue; font-weight: bold');
                const response = await handleFieldMatching({
                    formFields: optimizedFields,
                    formData: fileData,
                    apiKey: openai_api_key
                });

                if (response.error) {
                    throw new Error(response.error);
                }

                await fillFormFields(response.data);
                
            } catch (error) {
                throw error;
            }
    
        } catch (error) {
            console.error('Error:', error);
            alert(error.message);
        } finally {
            // Hide loader and re-enable button
            loader.style.display = 'none';
            testFillButton.disabled = false;
        }
    });
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    

    // Initial load
    loadFilesList();

    // Add new function for filling fields
    async function fillFormFields(aiResponse) {
        try {
            console.log('Starting to fill form fields with AI response:', aiResponse);
            
            // Extract fields array from response
            const fields = aiResponse.fields || [];
            console.log('Extracted fields:', fields);
            
            if (fields.length === 0) {
                throw new Error('No fields to fill in the response');
            }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) {
                throw new Error('No active tab found');
            }

            const fillResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: (fieldsToFill) => {
                    console.log('Starting to fill fields:', fieldsToFill);
                    const results = [];

                    function findFieldInAllContexts(field) {
                        console.log('Finding field:', field);
                        
                        // Try by ID first if available
                        if (field.id) {
                            const elById = document.getElementById(field.id);
                            if (elById) {
                                console.log('Found by ID:', field.id);
                                return elById;
                            }
                        }
                        
                        // Try by name if available
                        if (field.name) {
                            const elByName = document.querySelector(`[name="${field.name}"]`);
                            if (elByName) {
                                console.log('Found by name:', field.name);
                                return elByName;
                            }
                        }
                        
                        console.log('Field not found:', field);
                        return null;
                    }

                    function simulateTyping(element, value) {
                        try {
                            if (!element || !value) return false;
                            
                            // Handle different input types
                            if (element.tagName === 'SELECT') {
                                console.log('Handling SELECT element with value:', value);
                                
                                // Click to open the dropdown
                                element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                element.focus();
                                
                                // Get the first 4 characters of the value to type
                                const searchText = value.substring(0, 4);
                                console.log('Typing search text:', searchText);
                                
                                // Simulate typing the first few characters
                                const inputEvent = new InputEvent('input', {
                                    bubbles: true,
                                    inputType: 'insertText',
                                    data: searchText
                                });
                                element.dispatchEvent(inputEvent);
                                
                                // Find matching option
                                const options = Array.from(element.options);
                                const matchingOption = options.find(opt => 
                                    opt.text.toLowerCase().includes(value.toLowerCase()) || 
                                    opt.value.toLowerCase().includes(value.toLowerCase())
                                );
                                
                                if (matchingOption) {
                                    console.log('Found matching option:', matchingOption.text);
                                    element.value = matchingOption.value;
                                    
                                    // Simulate pressing Enter
                                    element.dispatchEvent(new KeyboardEvent('keydown', {
                                        bubbles: true,
                                        key: 'Enter',
                                        keyCode: 13
                                    }));
                                    
                                    element.dispatchEvent(new Event('change', { bubbles: true }));
                                    return true;
                                }
                                return false;
                            } else if (element.type === 'checkbox' || element.type === 'radio') {
                                // For checkboxes and radio buttons
                                const shouldCheck = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes';
                                element.checked = shouldCheck;
                                element.dispatchEvent(new Event('change', { bubbles: true }));
                                return true;
                            } else {
                                // For text inputs and textareas
                                element.value = '';
                                element.dispatchEvent(new Event('input', { bubbles: true }));
                                element.focus();
                                
                                // Type each character
                                value.split('').forEach(char => {
                                    element.value += char;
                                    element.dispatchEvent(new InputEvent('input', {
                                        bubbles: true,
                                        inputType: 'insertText',
                                        data: char
                                    }));
                                });
                                
                                element.dispatchEvent(new Event('change', { bubbles: true }));
                                element.blur();
                                return true;
                            }
                        } catch (error) {
                            console.error('Error simulating typing:', error);
                            return false;
                        }
                    }

                    // Process each field
                    fieldsToFill.forEach(field => {
                        console.log('Processing field:', field);
                        const element = findFieldInAllContexts(field);
                        
                        if (element) {
                            console.log('Found element:', element);
                            const success = simulateTyping(element, field.value);
                            results.push({
                                id: field.id,
                                name: field.name,
                                value: field.value,
                                success,
                                found: true
                            });
                            console.log(`Field ${field.id || field.name} ${success ? 'filled' : 'failed'}`);
                        } else {
                            results.push({
                                id: field.id,
                                name: field.name,
                                found: false
                            });
                            console.log(`Field ${field.id || field.name} not found`);
                        }
                    });

                    return results;
                },
                args: [fields]
            });

            // Log results
            console.log('Fill results:', fillResults);

            // Show summary
            const summary = fillResults[0].result.reduce((acc, result) => {
                if (!result.found) acc.notFound++;
                else if (!result.success) acc.failed++;
                else acc.filled++;
                return acc;
            }, { filled: 0, failed: 0, notFound: 0 });

            console.log('Fill summary:', summary);
            return { success: true, summary, details: fillResults[0].result };

        } catch (error) {
            console.error('Error filling form fields:', error);
            return { success: false, error: error.message };
        }
    }

    // Load saved settings
    chrome.storage.local.get(['openai_api_key', 'server_url', 'api_type', 'model'], (result) => {
        if (result.openai_api_key) {
            apiKeyInput.value = result.openai_api_key;
        }
        if (result.server_url) {
            serverUrlInput.value = result.server_url;
        }
        if (result.api_type) {
            const radio = Array.from(apiTypeRadios).find(r => r.value === result.api_type);
            if (radio) radio.checked = true;
        }
        if (result.model) {
            modelSelect.value = result.model;
        }
    });

    // Save settings when changed
    serverUrlInput.addEventListener('change', () => {
        chrome.storage.local.set({ server_url: serverUrlInput.value });
    });

    // Function to toggle API sections visibility
    function toggleApiSections(apiType) {
        const openaiSection = document.getElementById('openaiSection');
        const localSection = document.getElementById('localSection');
        
        if (apiType === 'openai') {
            openaiSection.style.display = 'block';
            localSection.style.display = 'none';
        } else {
            openaiSection.style.display = 'none';
            localSection.style.display = 'block';
        }
    }

    // Handle radio button changes
    apiTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const apiType = e.target.value;
            chrome.storage.local.set({ api_type: apiType });
            toggleApiSections(apiType);
        });
    });

    // Initialize visibility based on saved setting
    chrome.storage.local.get(['api_type'], (result) => {
        const apiType = result.api_type || 'openai';
        const radio = Array.from(apiTypeRadios).find(r => r.value === apiType);
        if (radio) {
            radio.checked = true;
            toggleApiSections(apiType);
        }
    });

    // Save model selection
    modelSelect.addEventListener('change', () => {
        chrome.storage.local.set({ model: modelSelect.value });
    });
}); 