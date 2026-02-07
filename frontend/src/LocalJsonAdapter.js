export class LocalJsonAdapter {
    constructor() {
        this.name = 'Личный (JSON)';
        this.type = 'local';
        this.fileHandle = null;
        this.data = [];
    }

    async setFileHandle(handle) {
        this.fileHandle = handle;
        await this.loadFromFile();
    }

    async loadFromFile() {
        if (!this.fileHandle) return;
        const file = await this.fileHandle.getFile();
        const content = await file.text();
        try {
            this.data = JSON.parse(content || '[]');
        } catch (e) {
            console.error('Failed to parse local JSON:', e);
            this.data = [];
        }
    }

    async saveToFile() {
        if (!this.fileHandle) return;
        const writable = await this.fileHandle.createWritable();
        await writable.write(JSON.stringify(this.data, null, 2));
        await writable.close();
    }

    async getPumps() {
        return this.data;
    }

    async savePump(formData) {
        // Convert FormData back to object for JSON storage
        const pump = {};
        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                // In local mode, we might want to store the file as base64 or just skip it for now
                // The File System Access API doesn't easily store blobs in JSON.
                // For simplicity, we'll store the filename and maybe skip the data or store it as Base64.
                // Let's store drawing as base64 for local portability.
                if (value.size > 0) {
                    pump[key + '_filename'] = value.name;
                    pump[key + '_data'] = await this.fileToBase64(value);
                }
            } else {
                pump[key] = value;
            }
        }

        const id = formData.get('id');
        if (id && id !== 'NEW') {
            const index = this.data.findIndex(p => p.id == id);
            if (index !== -1) {
                pump.updated_at = new Date().toLocaleString('ru-RU');
                this.data[index] = { ...this.data[index], ...pump };
            } else {
                pump.id = Date.now();
                pump.created_at = pump.updated_at = new Date().toLocaleString('ru-RU');
                this.data.push(pump);
            }
        } else {
            pump.id = Date.now();
            pump.created_at = pump.updated_at = new Date().toLocaleString('ru-RU');
            this.data.push(pump);
        }

        await this.saveToFile();
        return { ...pump, h_coeffs: JSON.parse(pump.h_text || '[]'), status: 'ok' };
    }

    async deletePump(id) {
        this.data = this.data.filter(p => p.id != id);
        await this.saveToFile();
        return { status: 'ok' };
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    async getDrawing(pump) {
        // If it's a base64 string, return it as is or as a blob URL
        if (pump.drawing_data) {
            return pump.drawing_data;
        }
        return null;
    }
}
