class AuthManager {
    constructor() {
        this.token = localStorage.getItem('auth_token');
        this.user = JSON.parse(localStorage.getItem('user_info') || 'null');
    }

    async login(email, password) {
        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);

        const response = await fetch('/api/auth/login', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Login failed');
        }

        const data = await response.json();
        this.token = data.access_token;
        localStorage.setItem('auth_token', this.token);

        await this.fetchMe();
        return this.user;
    }

    async register(email, password, orgName) {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, org_name: orgName })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Registration failed');
        }

        const data = await response.json();
        this.token = data.access_token;
        localStorage.setItem('auth_token', this.token);

        await this.fetchMe();
        return this.user;
    }

    async fetchMe() {
        if (!this.token) return null;
        const response = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });
        if (response.ok) {
            this.user = await response.json();
            localStorage.setItem('user_info', JSON.stringify(this.user));
        } else {
            this.logout();
        }
        return this.user;
    }

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_info');
    }

    getAuthHeader() {
        return this.token ? { 'Authorization': `Bearer ${this.token}` } : {};
    }

    isAuthenticated() {
        return !!this.token;
    }
}

export const authManager = new AuthManager();
