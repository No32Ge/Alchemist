// Test native JavaScript file execution and DOM interaction
console.log("[VFS Kernel] Pure HTML/CSS/JS applet loaded successfully!");

let clicks = 0;
const counterBtn = document.getElementById('counter-btn');
const counterBadge = document.getElementById('counter-badge');
const clickFeedback = document.getElementById('click-feedback');
const titleText = document.getElementById('interactive-title');

if (counterBtn && counterBadge) {
    counterBtn.addEventListener('click', () => {
        clicks++;
        counterBadge.textContent = clicks;
        
        // Dynamic bounce effect
        counterBadge.style.transform = 'scale(1.2)';
        setTimeout(() => {
            counterBadge.style.transform = 'scale(1)';
        }, 120);

        // Feedback message reveal
        if (clickFeedback) {
            clickFeedback.classList.remove('opacity-0');
            clickFeedback.classList.add('opacity-100');
            setTimeout(() => {
                clickFeedback.classList.remove('opacity-100');
                clickFeedback.classList.add('opacity-0');
            }, 1500);
        }

        // Color shifts occasionally for fun
        if (clicks % 5 === 0 && titleText) {
            console.log(`[VFS Interaction] Triggered color shift for click event ${clicks}!\n`);
            titleText.style.filter = 'hue-rotate(90deg)';
            setTimeout(() => {
                titleText.style.filter = 'hue-rotate(0deg)';
            }, 1000);
        }
    });
}
