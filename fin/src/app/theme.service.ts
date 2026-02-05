import { Injectable, signal, effect, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    darkMode = signal<boolean>(false);

    constructor(@Inject(PLATFORM_ID) private platformId: Object) {
        if (isPlatformBrowser(this.platformId)) {
            // Load state from local storage only in browser
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'dark') {
                this.darkMode.set(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                // Auto-detect system preference if no saved preference
                this.darkMode.set(true);
            }
        }

        // Effect to apply class to body and save to local storage
        effect(() => {
            const isDark = this.darkMode();
            if (isPlatformBrowser(this.platformId)) {
                if (isDark) {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    localStorage.setItem('theme', 'dark');
                } else {
                    document.documentElement.setAttribute('data-theme', 'light');
                    localStorage.setItem('theme', 'light');
                }
            }
        });
    }

    toggleTheme() {
        this.darkMode.update(val => !val);
    }
}
