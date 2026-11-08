<!--
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
-->

<template>

	<div :class="$style.footer">
			<slot />
	</div>

</template>


<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .footer {
    bottom: 0;
    left: 0;
    right: 0;
    min-height: calc(var(--spacing-xxl)*1.5);
    border-top: 1px solid var(--signin-gray);

    font-size: var(--font-12);

    display: flex;
    align-items: center;
    justify-content: center;
    span {
      padding-right: var(--spacing-xs);
    }

    .heart {
      font-size: var(--font-24);
    }
  }

  @media screen and (min-height: 500px) {
    .footer {
      position: fixed;
    }
  }

  @media screen and (max-height: 500px) {
    .footer {
      position: relative;
      margin-top: var(--spacing-xxl);
    }
  }

</style>
