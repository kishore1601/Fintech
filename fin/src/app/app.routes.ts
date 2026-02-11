import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';

export const routes: Routes = [
    { path: 'login', component: LoginComponent },
    { path: 'forgot-password', loadComponent: () => import('./forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent) },
    { path: 'settings', loadComponent: () => import('./settings/profile-settings.component').then(m => m.ProfileSettingsComponent) },
];
