import { ref } from 'vue';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { useContactsStore } from '@common/store';

export function useContactInMessage() {
  const { addContact  } = useContactsStore();

  const addressMenuData = ref({
    address: null as Nullable<string>,
    isOpen: false,
    triggerElement: null as Nullable<HTMLElement>,
  });

  function openAddressMenu(address: string) {
    const chipEl = document.getElementById(address);
    addressMenuData.value = {
      address,
      isOpen: true,
      triggerElement: chipEl,
    };
  }

  async function addNewContact() {
    const address = addressMenuData.value.address;
    addressMenuData.value = {
      address: null,
      isOpen: false,
      triggerElement: null,
    };

    if (address) {
      await addContact(address);
    }
  }

  return {
    addressMenuData,
    openAddressMenu,
    addNewContact,
  }
}
