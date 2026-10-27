import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@/assets/styles/main.css';

import App from '@picker/desktop/pages/app.vue';
import { bootstrapPicker } from '@picker/common/bootstrap';

bootstrapPicker({
  rootComponent: App,
  mountSelector: '#main-picker',
});
