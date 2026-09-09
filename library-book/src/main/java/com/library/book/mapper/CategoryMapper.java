// library-book/src/main/java/com/library/book/mapper/CategoryMapper.java
package com.library.book.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.library.book.domain.Category;
import org.apache.ibatis.annotations.Mapper;

/**
 * 图书分类Mapper接口
 */
@Mapper
public interface CategoryMapper extends BaseMapper<Category> {

}