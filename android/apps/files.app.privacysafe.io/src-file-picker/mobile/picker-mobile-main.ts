import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@/assets/styles/main.css';

import PickerMobileApp from '@picker/mobile/pages/picker-mobile-app.vue';
import { bootstrapPicker } from '@picker/common/bootstrap';

bootstrapPicker({
  rootComponent: PickerMobileApp,
  mountSelector: '#picker-mobile',
});
