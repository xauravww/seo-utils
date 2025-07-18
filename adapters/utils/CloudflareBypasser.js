class CloudflareBypasser {
    constructor(page, maxRetries = 5, log = true) {
        this.page = page;
        this.maxRetries = maxRetries;
        this.log = log;
    }

    async logMessage(msg) {
        if (this.log) console.log(msg);
    }

    async isBypassed() {
        const title = (await this.page.title()).toLowerCase();
        return !title.includes('just a moment') && !title.includes('attention required');
    }

    async clickVerificationButton() {
        try {
            const frames = this.page.frames();
            for (const frame of frames) {
                const input = await frame.$('input[type="checkbox"], input[type="submit"], button');
                if (input) {
                    await this.logMessage('Verification input/button found in frame. Attempting to click.');
                    await input.click();
                    return true;
                }
            }
            const mainInput = await this.page.$('input[type="checkbox"], input[type="submit"], button');
            if (mainInput) {
                await this.logMessage('Verification input/button found on main page. Attempting to click.');
                await mainInput.click();
                return true;
            }
            await this.logMessage('Verification button not found.');
            return false;
        } catch (e) {
            await this.logMessage(`Error clicking verification button: ${e}`);
            return false;
        }
    }

    async bypass() {
        let tryCount = 0;
        while (!(await this.isBypassed())) {
            if (this.maxRetries > 0 && tryCount >= this.maxRetries) {
                await this.logMessage('Exceeded maximum retries. Bypass failed.');
                break;
            }
            await this.logMessage(`Attempt ${tryCount + 1}: Verification page detected. Trying to bypass...`);
            await this.clickVerificationButton();
            tryCount += 1;
            await this.page.waitForTimeout(2000);
        }
        if (await this.isBypassed()) {
            await this.logMessage('Bypass successful.');
            return true;
        } else {
            await this.logMessage('Bypass failed.');
            return false;
        }
    }
}

export default CloudflareBypasser; 