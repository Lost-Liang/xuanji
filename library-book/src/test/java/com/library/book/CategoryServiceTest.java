// library-book/src/test/java/com/library/book/CategoryServiceTest.java
package com.library.book;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;
import static org.junit.jupiter.api.Assertions.*;
import com.library.book.domain.Category;
import com.library.book.service.CategoryService;

@SpringBootTest
@Transactional
class CategoryServiceTest {

    @Autowired
    private CategoryService categoryService;

    @Test
    void testSaveAndQueryCategory() {
        // Given
        Category category = new Category();
        category.setName("计算机");
        category.setParentId(0L);
        category.setSort(1);

        // When
        boolean saved = categoryService.save(category);
        Category found = categoryService.getById(category.getId());

        // Then
        assertTrue(saved);
        assertNotNull(found);
        assertEquals("计算机", found.getName());
    }

    @Test
    void testGetCategoryTree() {
        // Given
        Category parent = new Category();
        parent.setName("文学");
        parent.setParentId(0L);
        categoryService.save(parent);

        Category child = new Category();
        child.setName("小说");
        child.setParentId(parent.getId());
        categoryService.save(child);

        // When
        List<Category> tree = categoryService.getCategoryTree();

        // Then
        assertFalse(tree.isEmpty());
    }
}