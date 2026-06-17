<template>
  <v-container fluid class="fill-height pa-2 align-start">
    <v-card class="aa-page-card" width="100%">
      <v-card-title class="text-subtitle-1 d-flex align-center">
        <v-icon class="mr-2">mdi-image-filter-center-focus</v-icon>
        {{ $t("plugins.duetToolAlign.title") }}
      </v-card-title>
      <v-divider />
      <AutoAlignWidget />
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import AutoAlignWidget from "./widgets/AutoAlignWidget.vue";
</script>

<style scoped>
.aa-page-card { display: flex; flex-direction: column; max-height: calc(100vh - 120px); }
</style>
