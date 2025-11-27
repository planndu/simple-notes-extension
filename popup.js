const VALID_TABS = new Set(['new-note', 'saved-notes']);

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    
    if (!VALID_TABS.has(target)) {
      console.warn('Invalid tab target:', target);
      return;
    }
    
    const targetElement = document.getElementById(target);
    if (!targetElement) {
      console.warn('Target element not found:', target);
      return;
    }
    
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    targetElement.classList.add('active');
  });
});

const MAX_NOTE_LENGTH = 100000;
const MAX_DRAFT_LENGTH = 100000;
const MAX_TOTAL_NOTES = 1000;
const MAX_DATE_LENGTH = 200;
const MAX_ID_LENGTH = 100;
const DEBOUNCE_DELAY = 300;

let notes = [];
let draftNote = '';
let draftSaveTimeout = null;

// Validation helper
function isValidNote(note) {
  return (
    note &&
    typeof note.id === 'string' &&
    typeof note.content === 'string' &&
    typeof note.date === 'string' &&
    note.content.length > 0 &&
    note.content.length <= MAX_NOTE_LENGTH &&
    note.id.length > 0 &&
    note.id.length <= MAX_ID_LENGTH &&
    note.date.length > 0 &&
    note.date.length <= MAX_DATE_LENGTH
  );
}

const noteInput = document.getElementById('noteInput');
const charCount = document.getElementById('charCount');

// Load notes and draft from storage
chrome.storage.local.get(['notes', 'draftNote'], (result) => {
  const rawNotes = Array.isArray(result.notes) ? result.notes : [];
  
  notes = rawNotes
    .filter(isValidNote)
    .slice(0, MAX_TOTAL_NOTES);
  
  const rawDraft = result.draftNote;
  draftNote = (typeof rawDraft === 'string' && rawDraft.length <= MAX_DRAFT_LENGTH) ? rawDraft : '';
  
  // Restore draft note
  noteInput.value = draftNote;
  charCount.textContent = draftNote.length;
  
  renderNotes();
});

noteInput.addEventListener('input', () => {
  const length = noteInput.value.length;
  charCount.textContent = length;
  
  if (length > MAX_DRAFT_LENGTH) {
    noteInput.value = noteInput.value.slice(0, MAX_DRAFT_LENGTH);
    charCount.textContent = MAX_DRAFT_LENGTH;
    return;
  }
  
  // Auto-save draft
  draftNote = noteInput.value;
  
  // Clear existing timeout
  if (draftSaveTimeout) {
    clearTimeout(draftSaveTimeout);
  }
  
  // Set new timeout
  draftSaveTimeout = setTimeout(() => {
    try {
      chrome.storage.local.set({ draftNote }, () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to save draft:', chrome.runtime.lastError);
        }
      });
    } catch (e) {
      console.error('Failed to save draft:', e);
    }
  }, DEBOUNCE_DELAY);
});

// Save note
document.getElementById('saveNote').addEventListener('click', saveNote);

// Keyboard shortcut: Ctrl/Cmd + Enter to save
noteInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    saveNote();
  }
});

function saveNote() {
  const content = noteInput.value.trim();
  
  if (!content) {
    return;
  }
  
  if (content.length > MAX_NOTE_LENGTH) {
    showError('Note is too long. Maximum length is ' + MAX_NOTE_LENGTH + ' characters.');
    return;
  }
  
  if (notes.length >= MAX_TOTAL_NOTES) {
    showError('Maximum number of notes reached. Delete some notes to save more.');
    return;
  }
  
  const noteId = crypto.randomUUID();
  const noteDate = new Date().toLocaleString();
  
  const newNote = {
    id: noteId,
    content: content,
    date: noteDate
  };
  
  if (!isValidNote(newNote)) {
    showError('Failed to create note. Please try again.');
    return;
  }
  
  notes.unshift(newNote);
  
  noteInput.value = '';
  charCount.textContent = '0';
  draftNote = '';
  
  try {
    chrome.storage.local.set({ notes, draftNote: '' }, () => {
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError.message || '';
        
        if (error.includes('QUOTA') || error.includes('quota')) {
          showError('Storage full. Delete some notes to save more.');
        } else {
          showError('Failed to save note. Please try again.');
        }
        
        console.error('Failed to save note:', chrome.runtime.lastError);
        
        // Rollback on failure
        notes.shift();
        return;
      }
      
      renderNotes();
      
      // Switch to saved notes tab
      const savedNotesTab = document.querySelector('[data-tab="saved-notes"]');
      if (savedNotesTab) {
        savedNotesTab.click();
      }
    });
  } catch (e) {
    console.error('Failed to save note:', e);
    showError('Failed to save note. Please try again.');
    
    // Rollback on failure
    notes.shift();
    return;
  }
}

function deleteNote(id) {
  if (typeof id !== 'string' || !id) {
    console.warn('Invalid note ID for deletion:', id);
    return;
  }
  
  const noteExists = notes.some(n => n.id === id);
  if (!noteExists) {
    console.warn('Note not found for deletion:', id);
    return;
  }
  
  const originalNotes = [...notes];
  notes = notes.filter(n => n.id !== id);
  
  try {
    chrome.storage.local.set({ notes }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to delete note:', chrome.runtime.lastError);
        showError('Failed to delete note. Please try again.');
        
        // Rollback on failure
        notes = originalNotes;
        renderNotes();
        return;
      }
      
      renderNotes();
    });
  } catch (e) {
    console.error('Failed to delete note:', e);
    showError('Failed to delete note. Please try again.');
    
    // Rollback on failure
    notes = originalNotes;
    renderNotes();
    return;
  }
}

function renderNotes() {
  const container = document.getElementById('noteList');
  
  container.textContent = '';
  
  if (notes.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('viewBox', '0 0 20 20');
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('d', 'M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z');
    path.setAttribute('clip-rule', 'evenodd');
    
    svg.appendChild(path);
    
    const text = document.createElement('p');
    text.textContent = 'No saved notes yet.';
    const br = document.createElement('br');
    const text2 = document.createTextNode('Create one in the New Note tab!');
    text.appendChild(br);
    text.appendChild(text2);
    
    emptyState.appendChild(svg);
    emptyState.appendChild(text);
    container.appendChild(emptyState);
    return;
  }
  
  notes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card';
    
    const header = document.createElement('div');
    header.className = 'note-header';
    
    const date = document.createElement('span');
    date.className = 'note-date';
    date.textContent = note.date;
    
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = 'Delete';
    
    header.appendChild(date);
    header.appendChild(delBtn);
    
    const content = document.createElement('div');
    content.className = 'note-content';
    content.textContent = note.content;
    
    card.appendChild(header);
    card.appendChild(content);
    container.appendChild(card);
    
    delBtn.addEventListener('click', () => deleteNote(note.id));
  });
}

function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-notification';
  errorDiv.textContent = message;
  
  document.body.appendChild(errorDiv);
  
  // Remove after 4 seconds
  setTimeout(() => {
    errorDiv.classList.add('fade-out');
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 300);
  }, 4000);
}
