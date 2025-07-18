 // --- Forum HTML Parser (for forums, more permissive than WordPressAdapter) ---
class ForumAdapter {
    static toBasicHtml(input) {
        if (!input) return '';
        let html = input;
        // 1. Convert markdown links first
        html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        // 2. Now do bold/italic/underline, but NOT inside tags
        // Replace only text outside of tags
        html = html.replace(/(^|>)([^<]+)(?=<|$)/g, (match, p1, p2) => {
            return p1 + p2
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.*?)__/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/_(.*?)_/g, '<u>$1</u>');
        });
        // Lists
        html = html.replace(/^\s*[-\*\+] (.*)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
        // Paragraphs (double newlines)
        html = html.replace(/\n{2,}/g, '<br/><br/>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Blockquotes
        html = html.replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>');
        // Pre/code blocks
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        // Clean up nested <ul>
        html = html.replace(/(<ul>\s*)+(<li>.*?<\/li>)(\s*<\/ul>)+/gs, '<ul>$2</ul>');
        return html;
    }
}

export default ForumAdapter;