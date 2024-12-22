// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'matchFormFields') {
        console.log('Received request for field matching:', request);
        handleFieldMatching(request, sendResponse);
        return true; // Will respond asynchronously
    }
});

async function handleFieldMatching(request, sendResponse) {
    try {
        console.log('Starting field matching process');
        console.log('Form Fields to match:', request.formFields);
        console.log('Raw form data:', request.formData);

        const prompt = `Please analyze these form fields and match them with the provided form data:

Form Fields:
<form fields>
${JSON.stringify(request.formFields, null, 2)}
</form fields>

Form Fill-in Data:
<fill in data>
${request.formData.content}
</fill in data>

Instructions:
1. Analyze each input field's context (id, name, label, placeholder, associated text)
2. Look for matching information in the form data
3. For each match you find, add a "value" field to the input object
4. Return the entire form fields structure with added values
5. Only add values where you're confident about the match
6. Look for semantic matches, not just exact text matches
7. Consider common variations (firstName = first name = first_name)
8. If a field has multiple potential matches, choose the most likely one
9. Convert dates to the format in the placeholder 
10. For phone numbers also use the placeholder to determine the format (e.g. (123) 456-7890 or 123-456-7890 or +21321.. or 0021321...)

Return the modified form fields structure with added "value" fields where matches are found.`;

        console.log('Sending prompt to OpenAI:', prompt);
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${request.apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a form field matching assistant. Your task is to analyze form fields and their context, 
                        compare them with provided form filling data, and suggest matching values. 
                        The form filling data will be provided as text, which might be in JSON format or plain text format.
                        You should look at field names, labels, placeholders, and surrounding text to make intelligent matches.
                        Return your response as a JSON object with matched values.
                        Be creative in matching - look for semantic similarities, not just exact matches.
                        For example, "First Name" could match with "firstName", "first_name", "name.first", etc.`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3 // Lower temperature for more consistent results
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('OpenAI API error:', error);
            sendResponse({ error: error.error?.message || 'API request failed' });
            return;
        }

        const data = await response.json();
        console.log('Received response from OpenAI:', data);
        
        try {
            // Clean the response content from markdown JSON markers
            let jsonContent = data.choices[0].message.content;
            console.log('Raw content:', jsonContent);

            // Remove markdown JSON markers if they exist
            jsonContent = jsonContent.replace(/^```json\n/, '')  // Remove opening ```json
                                   .replace(/\n```$/, '')        // Remove closing ```
                                   .replace(/^```\n/, '')        // Remove opening ``` without json
                                   .trim();                      // Clean whitespace

            console.log('Cleaned content:', jsonContent);

            const matchedFields = JSON.parse(jsonContent);
            console.log('Successfully parsed matched fields:', matchedFields);
            sendResponse({ success: true, data: matchedFields });
        } catch (e) {
            console.error('Failed to parse AI response:', e);
            console.log('Raw AI response:', data.choices[0].message.content);
            sendResponse({ error: 'Failed to parse AI response. Please try again.' });
        }
    } catch (error) {
        console.error('Error in handleFieldMatching:', error);
        sendResponse({ error: error.message });
    }
} 